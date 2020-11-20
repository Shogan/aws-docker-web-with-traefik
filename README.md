# aws-docker-web-host-with-traefik

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
