import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import * as iam from "@aws-cdk/aws-iam";
import * as autoscaling from "@aws-cdk/aws-autoscaling";
import { Stack } from "@aws-cdk/core";

export type MixedAutoScalingGroupProps = Omit<autoscaling.AutoScalingGroupProps, "instanceType" | "spotPrice"> & {
  instanceTypes: ec2.InstanceType[];
  ec2UserData?: EC2UserDataOptions;
  instancesDistribution?: autoscaling.CfnAutoScalingGroup.InstancesDistributionProperty;
  ebsOptimized?: boolean;
};

export class MixedAutoScalingGroup extends autoscaling.AutoScalingGroup {
  constructor(scope: cdk.Construct, id: string, props: MixedAutoScalingGroupProps) {
    
    // instanceType here is redundant but is required for L2 ASG construct
    super(scope, id, { ...props, instanceType: new ec2.InstanceType("t4g.medium") });

    const { instanceTypes, ec2UserData: ec2UserData, instancesDistribution, ebsOptimized } = props;
    
    const stackName = Stack.of(this).stackName;

    const instanceProfile = new iam.CfnInstanceProfile(this, "InstProfile", {
      roles: [this.role.roleName]
    });

    let cfnAsgNode = (this.node.findChild("ASG") as autoscaling.CfnAutoScalingGroup);

    let launchTemplate = new ec2.CfnLaunchTemplate(this, "LaunchTemplate", {
      launchTemplateData: {
        userData: ec2UserData ? createEC2UserData(ec2UserData, cfnAsgNode.logicalId) : undefined,
        securityGroupIds: this.connections.securityGroups.map(sg => sg.securityGroupId),
        imageId: props.machineImage.getImage(this).imageId,
        ebsOptimized,
        iamInstanceProfile: { arn: instanceProfile.attrArn },
        keyName: props.keyName
      }
    });

    cfnAsgNode.addPropertyOverride("MixedInstancesPolicy", {
      InstancesDistribution: instancesDistribution ? capitalizeKeys(instancesDistribution) : undefined,
      LaunchTemplate: {
        LaunchTemplateSpecification: {
          LaunchTemplateId: launchTemplate.ref,
          Version: launchTemplate.attrLatestVersionNumber
        },
        Overrides: instanceTypes.map(t => ({ InstanceType: t.toString() }))
      }
    });

    cfnAsgNode.addPropertyOverride("LaunchConfigurationName", undefined);
  }
}

function capitalizeKeys(o: any): any {
  return Object.keys(o).reduce((res, k) => ({ ...res, [capitalize(k)]: o[k] }), {});
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type EC2UserDataOptions = {
  region: string;
  stackName: string;
  email: string;
  traefikDynContentUrl: string;
  efsFsId: string;
};

function createEC2UserData(opts: EC2UserDataOptions, cfnAsgLogicalId: string) {
    const { region, stackName, email, traefikDynContentUrl, efsFsId } = opts;
    const userDataLogPath = '/home/ec2-user/userdata-run.log';
    let res = `MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="==BOUNDARYMARKER=="

--==BOUNDARYMARKER==
Content-Type: text/cloud-config; charset="us-ascii"

runcmd:`;
    res += `
- cd /home/ec2-user`;
    res += `
- echo "Running in $(pwd) directory as $(whoami)" >> ${userDataLogPath}`;
    res += `
- /opt/aws/bin/cfn-init -v --stack ${stackName} --resource ${cfnAsgLogicalId} --region ${region}`;
    res += `
- yum update -y`;
    res += `
- sudo yum install amazon-efs-utils -y`;
    res += `
- sudo mkdir /data`;
    res += `
- sudo mount -t efs ${efsFsId}:/ /data`;
    res += `
- amazon-linux-extras install docker -y`;
    res += `
- service docker start`;
    res += `
- usermod -a -G docker ec2-user`;
    res += `
- usermod -a -G docker $USER`;
    res += `
- systemctl enable docker`;
    res += `
- sg docker -c "docker pull traefik:v2.3.2"`;
    res += `
- sg docker -c "docker network create web"`;
    res += `
- touch acme.json && chmod 600 acme.json`;
    res += `
- curl -O https://gist.githubusercontent.com/Shogan/5a3b73f53bd0d9f502855694f6521c76/raw/7fd13820c99962ee6fe4999a91c95fb3c9680d27/traefik-template.toml`;
    res += `
- sed -i -e 's/{{email}}/${email}/g' traefik-template.toml`;
    res += `
- rm -rf traefik.toml`;
    res += `
- mv traefik-template.toml traefik.toml`;
    res += `
- curl -o traefik_dynamic.toml ${traefikDynContentUrl}`;
    res += `
- sg docker -c "docker run --restart=always -d -p 8080:8080 -p 80:80 -p 443:443 --network web --name traefik -v $PWD/traefik.toml:/traefik.toml -v $PWD/traefik_dynamic.toml:/traefik_dynamic.toml -v $PWD/acme.json:/acme.json -v /var/run/docker.sock:/var/run/docker.sock traefik:v2.2"`;
    res += `
- echo "sending CFN signal for stack with ASG logical ID..." >> ${userDataLogPath}`;
    res += `
- /opt/aws/bin/cfn-signal -e $? --stack ${stackName} --resource ${cfnAsgLogicalId} --region ${region}`;
    res += `
--==BOUNDARYMARKER==`;
    return cdk.Fn.base64(res);
}