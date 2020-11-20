#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { AwsDockerWebWithTraefikStack } from '../lib/aws-docker-web-with-traefik-stack';
import { Stack } from '@aws-cdk/core';

const app = new cdk.App();

new AwsDockerWebWithTraefikStack(app, 'AwsDockerWebWithTraefikStack', {
    env: {
        region: process.env.CDK_DEFAULT_REGION,
        account: process.env.CDK_DEFAULT_ACCOUNT
    }
});
