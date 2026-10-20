import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type AddressResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const blocked = new BlockList();
const blockedRanges: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
];
for (const [address, prefix, family] of blockedRanges) blocked.addSubnet(address, prefix, family);

function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  // IPv4-mapped IPv6 can otherwise disguise a private IPv4 destination.
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isNonPublicAddress(mapped[1]!);
  return family === 4
    ? blocked.check(address, "ipv4")
    : blocked.check(address, "ipv6");
}

/**
 * Rejects hostnames that resolve to any private, local, reserved, or invalid address.
 * This is a preflight check only: the destination can resolve differently later.
 */
export async function validatePublicEndpointResolution(
  hostname: string,
  resolver: AddressResolver = async (host) => dnsLookup(host, { all: true, verbatim: true }),
): Promise<void> {
  if (isIP(hostname) !== 0) throw new Error("Endpoint must use a public DNS hostname, not an IP literal");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new Error("Endpoint hostname could not be resolved");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isNonPublicAddress(address))) {
    throw new Error("Endpoint hostname resolves to a private, local, reserved, or invalid address");
  }
}
