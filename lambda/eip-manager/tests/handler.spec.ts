import * as chai from 'chai';
import * as sinon from "sinon";
import { assert } from "sinon";

import * as ec2ops from '../src/ec2operations';
import { handler } from '../src/index';
import sinonChai from "sinon-chai";
import { PromiseResult } from 'aws-sdk/lib/request';
import { DescribeAddressesResult, AssociateAddressResult } from "aws-sdk/clients/ec2";
import { Response } from 'aws-sdk';
import { AWSError } from 'aws-sdk';

const expect = chai.expect;

chai.use(sinonChai);

const ec2RunningEvent = {
  'detail-type': 'EC2 Instance State-change Notification',
  source: 'aws.ec2',
  account: '123456789012',
  time: '2020-11-20T16:28:46Z',
  region: 'eu-west-1',
  resources: [ 'arn:aws:ec2:eu-west-1:123456789012:instance/i-039f2963f1729d900' ],
  detail: { 'instance-id': 'i-123f2963f1729d500', state: 'running' }
};

const ec2PendingEvent = {
  'detail-type': 'EC2 Instance State-change Notification',
  source: 'aws.ec2',
  account: '123456789012',
  time: '2020-11-20T16:28:46Z',
  region: 'eu-west-1',
  resources: [ 'arn:aws:ec2:eu-west-1:123456789012:instance/i-039f2963f1729d900' ],
  detail: { 'instance-id': 'i-123f2963f1729d500', state: 'pending' }
};

const ec2TerminatedEvent = {
  'detail-type': 'EC2 Instance State-change Notification',
  source: 'aws.ec2',
  account: '123456789012',
  time: '2020-11-20T16:28:46Z',
  region: 'eu-west-1',
  resources: [ 'arn:aws:ec2:eu-west-1:123456789012:instance/i-039f2963f1729d900' ],
  detail: { 'instance-id': 'i-123f2963f1729d500', state: 'terminated' }
};

const testAllocationId1 = "eipalloc-11d0032a113f60fd4";
const testAllocationId2 = "eipalloc-12d0032a113f60fd4";
const testAllocationId3 = "eipalloc-13d0032a113f60fd4";

describe("lambda-handler", () => {
  describe("handler", () => {

    const describeAddressesStub = sinon.stub(ec2ops, "getTraefikEipAddresses");

    let describeAddressesResult : PromiseResult<DescribeAddressesResult, AWSError> = {
        $response: new Response<DescribeAddressesResult, AWSError>(),
        Addresses: [
          { AllocationId: testAllocationId1, PublicIp: '1.1.1.1', Domain: 'vpc', PublicIpv4Pool: 'amazon', NetworkBorderGroup: 'eu-west-1' },
          { AllocationId: testAllocationId2, PublicIp: '1.1.1.1', Domain: 'vpc', PublicIpv4Pool: 'amazon', NetworkBorderGroup: 'eu-west-1' },
          { AllocationId: testAllocationId3, PublicIp: '1.1.1.1', Domain: 'vpc', PublicIpv4Pool: 'amazon', NetworkBorderGroup: 'eu-west-1' }
        ]
    };

    describeAddressesStub.resolves(describeAddressesResult);

    const associatedAddressStub = sinon.stub(ec2ops, "associateAddressToInstance");
    associatedAddressStub.resolves();

    it("should associate the first found EIP to the instanceId specified in the 'running' event", async () => {

      // WHEN

      const result = await handler(ec2RunningEvent);
      
      // THEN

      expect(result).to.exist;
      expect(result).to.eql(`asscociated ${testAllocationId1} with ${ec2RunningEvent.detail["instance-id"]}.`);
      assert.calledOnce(describeAddressesStub);
      assert.calledOnce(associatedAddressStub);
    });

    it("should ignore 'pending' EC2 instance events", async () => {

      // WHEN
      describeAddressesStub.resetHistory();
      associatedAddressStub.resetHistory();
      const result = await handler(ec2PendingEvent);
      
      // THEN

      expect(result).to.exist;
      expect(result).to.eql(`nothing to do`);
      assert.notCalled(describeAddressesStub);
      assert.notCalled(associatedAddressStub);
    });

    

    it("should ignore 'terminated' EC2 instance events", async () => {

      // WHEN
      describeAddressesStub.resetHistory();
      associatedAddressStub.resetHistory();
      const result = await handler(ec2PendingEvent);
      
      // THEN

      expect(result).to.exist;
      expect(result).to.eql(`nothing to do`);
      assert.notCalled(describeAddressesStub);
      assert.notCalled(associatedAddressStub);
    });
  });
});