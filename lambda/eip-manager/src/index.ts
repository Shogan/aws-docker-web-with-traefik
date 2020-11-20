import { associateAddressToInstance, getTraefikEipAddresses } from './ec2operations';
import { Context } from 'aws-lambda';

export const handler = async (event: any, context?: Context) => {

    try {
        console.log(event);

        if (event.detail.state === "running") {
            const instanceId = event.detail["instance-id"];
            const traefikEips = await getTraefikEipAddresses();
            console.log('traefik EIPs', traefikEips);

            if (traefikEips.Addresses) {
                const viableAddresses = traefikEips.Addresses.filter(add => add.AllocationId !== undefined);
                console.log('viable addresses', viableAddresses);
                const allocationId = viableAddresses[0].AllocationId as string;
                await associateAddressToInstance(instanceId, allocationId);
                return `asscociated ${allocationId} with ${instanceId}.`;
            } else {
                throw "no viable or available EIPs found";
            }

        } else {
            return "nothing to do";
        }
    } catch (err) {
        console.log("Error", err);
        throw err;
    }
}