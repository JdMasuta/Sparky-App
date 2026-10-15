import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NETWORKS,
  appContainerName,
  buildAppContainerSpec,
  buildRestoreHelperSpec,
} from "../../deploy/edge/app-spec.mjs";

const base = {
  image: "ghcr.io/jdmasuta/sparky-app@sha256:" + "a".repeat(64),
  name: "sparky-app-3.7.0-abc123",
  version: "3.7.0",
  tz: "America/Chicago",
  orchUrl: "http://sparky-orchestrator:3200",
  orchToken: "f".repeat(64),
  controlSubnet: "172.30.1.0/24",
  backupHostDir: "/mnt/c/SparkyData/backups",
};

const envMap = (spec) => Object.fromEntries(spec.create.Env.map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]));

test("appContainerName", () => {
  assert.equal(appContainerName("3.7.0", "abc123"), "sparky-app-3.7.0-abc123");
  assert.equal(appContainerName("3.7.0+x/y", "ABC"), "sparky-app-3.7.0-x-y-ABC");
  assert.throws(() => appContainerName("3.7.0", ""));
});

test("app containers are locked down", () => {
  const { create, extraNetworks } = buildAppContainerSpec(base);
  const hc = create.HostConfig;
  assert.equal(create.User, "node");
  assert.equal(hc.ReadonlyRootfs, true);
  assert.deepEqual(hc.CapDrop, ["ALL"]);
  assert.deepEqual(hc.SecurityOpt, ["no-new-privileges:true"]);
  assert.equal(hc.Init, true);
  assert.equal(hc.Privileged, undefined);
  assert.equal(hc.Binds, undefined);
  assert.equal(hc.PortBindings, undefined, "apps never publish ports");
  assert.equal(hc.NetworkMode, DEFAULT_NETWORKS.front);
  assert.deepEqual(extraNetworks, [DEFAULT_NETWORKS.control, DEFAULT_NETWORKS.egress]);
  assert.equal(hc.RestartPolicy.Name, "unless-stopped");
});

test("state comes only from the data volume (and the backup dir); never docker.sock", () => {
  const { create } = buildAppContainerSpec(base);
  assert.deepEqual(create.HostConfig.Mounts, [
    { Type: "volume", Source: "sparky-data", Target: "/data" },
    { Type: "bind", Source: "/mnt/c/SparkyData/backups", Target: "/backups" },
  ]);
  assert.ok(!JSON.stringify(create).includes("docker.sock"));
});

test("env carries no app secrets or device IP config", () => {
  const env = envMap(buildAppContainerSpec(base));
  for (const forbidden of [
    "ADMIN_PASSWORD_HASH",
    "SESSION_SECRET",
    "BRIDGE_TOKEN",
    "EMAIL_PASS",
    "EMAIL_USER",
    "PLC_IP",
    "PLC_MODE",
    "CORS_ORIGIN",
  ]) {
    assert.ok(!(forbidden in env), `${forbidden} must come from /data env files`);
  }
  assert.equal(env.SPARKY_DATA_DIR, "/data");
  assert.equal(env.TZ, "America/Chicago");
  assert.equal(env.TRUST_PROXY, "1");
  assert.equal(env.SPARKY_CONTAINER_NAME, base.name);
  assert.equal(env.SPARKY_BACKUP_DIR, "/backups");
  assert.equal(env.SPARKY_STANDBY, undefined);
});

test("standby containers wait for a handshake and never auto-restart", () => {
  const spec = buildAppContainerSpec({ ...base, standby: { predecessor: "sparky-app-3.6.0-x", handoverToken: "t".repeat(64) } });
  const env = envMap(spec);
  assert.equal(env.SPARKY_STANDBY, "1");
  assert.equal(env.SPARKY_PREDECESSOR, "sparky-app-3.6.0-x");
  assert.equal(env.SPARKY_HANDOVER_TOKEN, "t".repeat(64));
  assert.equal(spec.create.HostConfig.RestartPolicy.Name, "no");
  assert.throws(() => buildAppContainerSpec({ ...base, standby: { predecessor: "x" } }));
});

test("no backup dir: no bind mount and no SPARKY_BACKUP_DIR", () => {
  const spec = buildAppContainerSpec({ ...base, backupHostDir: "" });
  assert.equal(spec.create.HostConfig.Mounts.length, 1);
  assert.equal(envMap(spec).SPARKY_BACKUP_DIR, undefined);
});

test("required fields", () => {
  for (const key of ["image", "name", "tz", "orchUrl", "orchToken", "controlSubnet"]) {
    assert.throws(() => buildAppContainerSpec({ ...base, [key]: "" }), new RegExp(key));
  }
});

test("restore helper: old image, no network, data volume only", () => {
  const spec = buildRestoreHelperSpec({ image: "img@sha256:1", updateId: "u-1" });
  assert.equal(spec.HostConfig.NetworkMode, "none");
  assert.equal(spec.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(spec.HostConfig.Mounts, [{ Type: "volume", Source: "sparky-data", Target: "/data" }]);
  assert.deepEqual(spec.Cmd.slice(-4), ["--snapshot", "/data/backups/pre-u-1.sqlite", "--db", "/data/prod.sqlite"]);
  assert.throws(() => buildRestoreHelperSpec({ image: "x", updateId: "../evil" }));
});
