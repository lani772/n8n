import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicEndpointResolution } from "../src/dnsEndpointPolicy.js";

test("DNS policy accepts a hostname resolving only to public addresses", async () => {
  await assert.doesNotReject(() => validatePublicEndpointResolution("api.example.com", async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ]));
});

test("DNS policy rejects private and loopback IPv4 answers", async () => {
  for (const address of ["10.1.2.3", "172.20.0.4", "192.168.1.10", "127.0.0.1", "169.254.1.1", "100.64.0.1"]) {
    await assert.rejects(
      () => validatePublicEndpointResolution("api.example.com", async () => [{ address, family: 4 }]),
      /private, local, reserved, or invalid/,
    );
  }
});

test("DNS policy rejects local and reserved IPv6 answers", async () => {
  for (const address of ["::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "fc00::1", "fe80::1", "2001:db8::1", "ff02::1"]) {
    await assert.rejects(
      () => validatePublicEndpointResolution("api.example.com", async () => [{ address, family: 6 }]),
      /private, local, reserved, or invalid/,
    );
  }
});

test("DNS policy rejects mixed public/private answers", async () => {
  await assert.rejects(
    () => validatePublicEndpointResolution("api.example.com", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /private, local, reserved, or invalid/,
  );
});

test("DNS policy fails closed for empty and failed lookups", async () => {
  await assert.rejects(() => validatePublicEndpointResolution("api.example.com", async () => []), /private, local, reserved, or invalid/);
  await assert.rejects(() => validatePublicEndpointResolution("api.example.com", async () => { throw new Error("DNS failed"); }), /could not be resolved/);
});

test("DNS policy rejects IP literals", async () => {
  await assert.rejects(() => validatePublicEndpointResolution("127.0.0.1", async () => []), /public DNS hostname/);
});
