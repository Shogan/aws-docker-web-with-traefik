# aws-docker-web-host-with-traefik

An all-in-one solution to host multiple dynamic sites on a single, cheap spot instance Graviton2 processor based AWS EC2 machine, using a single Elastic IP, Docker, Traefik v2, and EFS for storage persistence. Traefik is configured to use the Let's Encrypt provider for free SSL certificate provisioning too.

Note: this is a very opinionated solution that is not geared for high-availability or enterprise use. This is geared toward personal site / blog hosting on the cheap.

## What?

This repository contains infrastructure-as-code defined in CDK (AWS Cloud Development Kit) that will build out the following:

* EC2 instance (backed by mixed autoscaling group configured specifically for a single spot instance)
* EFS storage
* Elastic IP
* Lambda Function that manages attaching the Elastic IP to the EC2 instance from the ASG whenever it is provisioned
* Secrets Manager Secret Entry that will provide all defined secret key/values as a **.env** file on the EC2 instance for your docker-compose stack to use

Parameters are fed in that provide traefik and traefik dynamic configurations. (You can override with your own). You can also pass in your own docker-compose stack (for example, as a github gist RAW URL). When the EC2 instance starts up, it'll start the Traefik container, pass in the configurations, and also start up the docker-compose stack.

## Requirements

* Have at least one Elastic IP address created in your account and tagged as: `Usage:Traefik` (that is key:value).
* AWS CDK installed

### CDK parameter requirements

You need to update the following variables at the top of **aws-docker-web-with-traefik-stack.ts**.

* traefik_dynamic.toml file created and available at a remote URL that is publicly accessible. You'll feed this URL in to the CDK app. This will contain the traefik config for all your web services you want to run.

```javascript
const vpcId = "vpc-your-vpc-or-default-vpc-id-here";
const instanceType = "t4g.medium"; // this is an AWS Graviton 2 Instance type. 4GB memory, 2 Cores. It will be run as a spot instance.
const keypairName = "your-existing-keypair-name";
const managementLocationCidr = "1.1.1.1/32"; // your home / management network address that SSH access will be allowed from. Change this!
const traefikDynContentUrl = "https://gist.githubusercontent.com/example/0111f05fb40a4aa00e9e8523b38ad129/raw/32372bbd0b195fe131e8513eccc881c7b007ac7c/traefik_dynamic.toml"; // this should point to your own dynamic traefik config in toml format.
const emailForLetsEncryptAcmeResolver = 'email = "youremail@example.com"'; // update this to your own email address for lets encrypt certs
const efsAutomaticBackups = false; // set to true to enable automatic backups for EFS
```

### Optional Settings

Use an existing Secrets Manager secret

To use an existing secret instead of provisioning a new one, just fill in the ARN of your secret in place of the default empty string (which would normally setup a new secret for you). For example:

```javascript
const envSecretsArn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:traefik/web/environment-ab45Xc1";
```

Override the default Traefik template:

You can override Traefik configuration template default by passing in your own URL to a publicly accessible config. In ** ** add the optional parameter called `traefikConfigTemplateUrl` to the **EC2UserDataOptions** object. For example, if you wanted to copy the default template that uses Let's Encrypt, and modify it to use the LE Staging server for test certificates instead, you could provide this configuration as a gist, and then set:

```javascript
ec2UserData: {
    traefikDynContentUrl: traefikDynContentUrl,
    email: emailForLetsEncryptAcmeResolver,
    region: Stack.of(this).region,
    stackName: Stack.of(this).stackName,
    efsFsId: fileSystem.fileSystemId,
    customDockerComposeUrl: customDockerComposeUrl,
    traefikConfigTemplateUrl: "https://gist.githubusercontent.com/example/123/raw/1234567890/traefik-le-staging-template.toml"
}
```

Just make sure your traefik template contains a `{{email}}` template section under the Let's Encrypt resolver config. The userdata script relies on this to replace this section on start-up with your own configured e-mail address. Example custom configuration that will use Let's Encrypt Staging server for test certificates:

```toml
[entryPoints]
  [entryPoints.web]
    address = ":80"
    [entryPoints.web.http.redirections.entryPoint]
      to = "websecure"
      scheme = "https"

  [entryPoints.websecure]
    address = ":443"

[api]
  dashboard = true

[certificatesResolvers.lets-encrypt.acme]
  {{email}}
  storage = "acme.json"
  caServer = "https://acme-staging-v02.api.letsencrypt.org/directory"
  [certificatesResolvers.lets-encrypt.acme.tlsChallenge]

[providers.docker]
  watch = true
  network = "web"

[providers.file]
  filename = "traefik_dynamic.toml"
```

## Build

From the root directory of this repository, `npm run build` will compile the typescript for the CDK project and EIP Manager Lambda function code.

## Deploy

**Note**: the app entrypoint uses the `CDK_DEFAULT_REGION` and `CDK_DEFAULT_ACCOUNT` environment variables. Make sure you're aware of your execution context when deploying.

* `cdk diff` to check any changes that will be made.
* `cdk deploy` to deploy the whole stack.

## Tests

From the **lambda/eip-manager** directory, run: `npm run test` to execute the EIP Manager Lambda tests.

## Data Persistence

EFS is created and configured in the CDK stack. The Traefik Docker Web Host instance will also mount the storage to **/data**.

The idea is that you put any persistent files you need for your containers in this location and then mount this host path into your docker containers. E.g. mysql databases, wordpress files, etc...

The Let's Encrypt file storage **acme.json** file that Traefik uses for storing provisioning certificates and metadata is kept/persisted to **/data/acme.json**. This means your existing certificates will be kept, even if your spot EC2 instance is terminated and brought up again. (Of course the same for your site data stored on the /data EFS mountpoint too).

## Notes

Traefik is started on the first EC2 instance boot time. The same is done for the docker-compose stack. They are not configured to start again on subsequent boots, and do not have any cron or systemd services associated to ensure they start again. This is still to be implemented. If your containers stop, you'll probably need to start them again.

Of course new EC2 instances provisioned from the ASG will be fine as they'll go through first-time boot sequences where the userdata script that starts everything will run.
