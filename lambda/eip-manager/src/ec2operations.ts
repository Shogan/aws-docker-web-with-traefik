import AWS = require("aws-sdk");
import { AWSError } from "aws-sdk";
import { DescribeAddressesResult, AssociateAddressResult } from "aws-sdk/clients/ec2";
import { PromiseResult } from "aws-sdk/lib/request";

var ec2 = new AWS.EC2({apiVersion: '2016-11-15'});

export function getTraefikEipAddresses() : Promise<PromiseResult<DescribeAddressesResult, AWSError>> {

  var eipDescribeParams = {
    Filters: [
      {Name: 'domain', Values: ['vpc']},
      {Name: 'tag:Usage', Values: ['Traefik']}
    ]
  };

  return ec2.describeAddresses(eipDescribeParams)
    .promise()
    .then(res => res)
    .catch((err) => { throw err; });
}

export function associateAddressToInstance(instanceId: string, allocationId: string) : Promise<PromiseResult<AssociateAddressResult, AWSError>> {

  var eipAssociateParams = {
    AllocationId: allocationId,
    InstanceId: instanceId
  };

  return ec2.associateAddress(eipAssociateParams)
    .promise()
    .then(res => res)
    .catch((err) => { throw err; });
}