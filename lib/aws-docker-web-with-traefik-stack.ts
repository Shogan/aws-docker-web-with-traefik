import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';
import * as efs from '@aws-cdk/aws-efs';
import * as sm from '@aws-cdk/aws-secretsmanager';
import * as fs from "fs";
import { InitConfig, SubnetType } from '@aws-cdk/aws-ec2';
import { MixedAutoScalingGroup } from './mixed-autoscaling-group';
import { Duration, RemovalPolicy, Stack, Tags } from '@aws-cdk/core';
import { Signals } from '@aws-cdk/aws-autoscaling';
import { LifecyclePolicy, PerformanceMode, ThroughputMode } from '@aws-cdk/aws-efs';

export class AwsDockerWebWithTraefikStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpcId = "vpc-your-vpc-or-default-vpc-id-here";
    const instanceType = "t4g.medium"; // this is an AWS Graviton 2 Instance type. 4GB memory, 2 Cores. It will be run as a spot instance.
    const keypairName = "your-existing-keypair-name";
    const managementLocationCidr = "1.1.1.1/32"; // your home / management network address that SSH access will be allowed from. Change this!
    const traefikDynContentUrl = "https://gist.githubusercontent.com/example/0111f05fb40a4aa00e9e8523b38ad129/raw/32372bbd0b195fe131e8513eccc881c7b007ac7c/traefik_dynamic.toml"; // this should point to your own dynamic traefik config in toml format.
    const emailForLetsEncryptAcmeResolver = 'email = "youremail@example.com"'; // update this to your own email address for lets encrypt certs
    const efsAutomaticBackups = false; // set to true to enable automatic backups for EFS
    const customDockerComposeUrl = "https://gist.githubusercontent.com/Shogan/815f03dd5c611b8dd3da9a299ac20ac5/raw/5b9463519497c0943d6258ad01c002db8e3a5f8a/docker-compose.yml"; // Point to your own, custom docker-compose.yml stack of services. These will be started at instance start.
    const envSecretsArn = "";

    const vpc = ec2.Vpc.fromLookup(this, 'VPC', {
      vpcId: vpcId
    });

    const envSecrets = envSecretsArn ? sm.Secret.fromSecretCompleteArn(this, 'EnvSecrets', envSecretsArn) : new sm.Secret(this, 'EnvSecrets', {
      description: "Traefik Web Environment Secrets",
      secretName: "traefik/web/environment",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'user' }),
        generateStringKey: 'EXAMPLE',
      },
    });

    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC
    });

    const amznLinuxArm64 = new ec2.AmazonLinuxImage({
      generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      edition: ec2.AmazonLinuxEdition.STANDARD,
      virtualization: ec2.AmazonLinuxVirt.HVM,
      storage: ec2.AmazonLinuxStorage.GENERAL_PURPOSE,
      cpuType: ec2.AmazonLinuxCpuType.ARM_64
    });

    const ec2Sg = new ec2.SecurityGroup(this, 'TraefikWebInstanceSg', {
      allowAllOutbound: true,
      securityGroupName: "aws-traefik-web-host-inbound",
      vpc: vpc,
    });

    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'allow HTTP from anywhere');
    ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'allow HTTPS access from anywhere');
    ec2Sg.addIngressRule(ec2.Peer.ipv4(managementLocationCidr), ec2.Port.tcp(8080), 'allow HTTP 8080 access from specific IP');
    ec2Sg.addIngressRule(ec2.Peer.ipv4(managementLocationCidr), ec2.Port.tcp(22), 'allow SSH access from specific IP');

    const efsMountPointSg = new ec2.SecurityGroup(this, 'EfsMountPointSg', {
      allowAllOutbound: true,
      securityGroupName: "aws-docker-web-with-traefik-efs-mount-point",
      vpc: vpc,
    });

    efsMountPointSg.addIngressRule(ec2Sg, ec2.Port.tcp(2049)), 'allow NFS mount point access from Traefik Web EC2 machine SG';

    const fileSystem = new efs.FileSystem(this, 'TraefikWebEfs', {
      vpc: vpc,
      throughputMode: ThroughputMode.BURSTING,
      enableAutomaticBackups: efsAutomaticBackups,
      encrypted: true,
      fileSystemName: 'web-host-data',
      securityGroup: efsMountPointSg,
      lifecyclePolicy: LifecyclePolicy.AFTER_90_DAYS,
      performanceMode: PerformanceMode.GENERAL_PURPOSE,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    let signals = Signals.waitForAll({
        timeout: Duration.seconds(180),
        minSuccessPercentage: 100
    });

    const asg = new MixedAutoScalingGroup(this, "MixedASG", {
      vpc,
      instanceTypes: [new ec2.InstanceType(instanceType)],
      minCapacity: 1,
      maxCapacity: 1,
      securityGroup: ec2Sg,
      signals: signals,
      keyName: keypairName,
      vpcSubnets: publicSubnets,
      machineImage: amznLinuxArm64,
      instancesDistribution: {
        spotInstancePools: 1,
        onDemandPercentageAboveBaseCapacity: 0
      },
      ec2UserData: {
        traefikDynContentUrl: traefikDynContentUrl,
        email: emailForLetsEncryptAcmeResolver,
        region: Stack.of(this).region,
        stackName: Stack.of(this).stackName,
        efsFsId: fileSystem.fileSystemId,
        customDockerComposeUrl: customDockerComposeUrl,
      }
    });

    Tags.of(asg).add("EnvSecretsArn", envSecrets.secretArn);

    asg.role.attachInlinePolicy(new iam.Policy(this, 'Ec2InstanceProfileRole', {
      policyName: "secretsmanager-access",
      statements: [
        new iam.PolicyStatement({
          resources: [envSecrets.secretArn],
          actions: ["secretsmanager:GetSecretValue"]
        }),
        new iam.PolicyStatement({
          resources: ["*"],
          actions: ["ec2:DescribeTags"]
        }),
      ]
    }));

    const eipManagerLambda = new lambda.Function(this, 'EipManagerLambda', {
      functionName: 'traefik-ec2-eip-manager',
      code: lambda.Code.fromAsset('lambda/eip-manager/dist/src'),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler'
    });

    const lambdaEipManagerPolicy = new iam.PolicyStatement({
      actions: [
        "ec2:AssociateAddress",
        "ec2:DescribeAddresses"
      ],
      resources: ["*"]
    });

    eipManagerLambda.addToRolePolicy(lambdaEipManagerPolicy);

    const ec2NewInstanceEvent = new events.Rule(this, 'NewEc2Event', {
      description: "Rule to match new, running EC2 instance events. The lambda that is invoked must check the tags to identify new traefik EC2 instances.",
      eventPattern: {
        source: ["aws.ec2"],
        detailType: ["EC2 Instance State-change Notification"]
      }
    });

    ec2NewInstanceEvent.addTarget(new targets.LambdaFunction(eipManagerLambda));

  }
}
