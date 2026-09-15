import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HomeAssistantEntityInformation } from "@home-assistant-matter-hub/common";
import { Environment, VariableService } from "@matter/general";
import { Endpoint, VendorId } from "@matter/main";
import { DescriptorServer } from "@matter/main/behaviors";
import { ServerNode } from "@matter/main/node";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BridgeDataProvider } from "../../../../services/bridges/bridge-data-provider.js";
import {
  type HomeAssistantAction,
  HomeAssistantActions,
} from "../../../../services/home-assistant/home-assistant-actions.js";
import { AggregatorEndpoint } from "../../aggregator-endpoint.js";
import { createLegacyEndpointType } from "../create-legacy-endpoint-type.js";
import {
  OvenStageModeServer,
  ovenStageOptions,
  VirtualOvenTemperatureServer,
} from "./oven-stage-test.js";

let dir: string;
let env: Environment;
let server: ServerNode | undefined;
let calls: { action: HomeAssistantAction; target: string }[];

function stage(state = "Stufe 1"): HomeAssistantEntityInformation {
  return {
    entity_id: "input_select.kamin_matter_heizstufe_test",
    state: {
      entity_id: "input_select.kamin_matter_heizstufe_test",
      state,
      attributes: {
        friendly_name: "Heizstufe",
        options: ["Off", "Stufe 1", "Stufe 2", "Stufe 3", "Stufe 4", "Stufe 5"],
      },
      context: { id: "test" },
      last_changed: "2026-09-15T00:00:00",
      last_updated: "2026-09-15T00:00:00",
      // biome-ignore lint/suspicious/noExplicitAny: minimal HA test fixture
    } as any,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hamh-oven-stage-"));
  env = new Environment("test", Environment.default);
  env.get(VariableService).set("storage.path", dir);
  calls = [];
  env.set(HomeAssistantActions, {
    call(action: HomeAssistantAction, target: string) {
      calls.push({ action, target });
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test action service
  } as any);
  env.set(
    BridgeDataProvider,
    new BridgeDataProvider({
      id: "test",
      name: "test",
      port: 0,
      filter: { include: [], exclude: [], includeMode: "any" },
      basicInformation: {
        vendorId: 0xfff1,
        vendorName: "t",
        productName: "t",
        productLabel: "t",
        hardwareVersion: 1,
        softwareVersion: 1,
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal bridge fixture
    } as any),
  );
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

it("rejects incomplete stage options rather than inventing valid-looking modes", () => {
  const entity = stage();
  Object.assign(entity.state.attributes, { options: ["Stufe 1", "Stufe 2"] });
  expect(() => ovenStageOptions(entity)).toThrow("Stufe 1 through Stufe 5");
});

it("mounts an Oven with a real Oven Mode cavity and routes stages only to the helper", async () => {
  const type = createLegacyEndpointType(stage("Stufe 2"), {
    entityId: stage().entity_id,
    matterDeviceType: "oven_stage_test",
    customName: "Heizstufe",
  });
  expect(type).toBeDefined();
  server = await ServerNode.create({
    // biome-ignore lint/suspicious/noExplicitAny: valid runtime Environment
    environment: env as any,
    id: "oven-stage-node",
    network: { port: 0 },
    commissioning: { passcode: 20202021, discriminator: 3840 },
    basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
  });
  const aggregator = new AggregatorEndpoint("aggregator");
  await server.add(aggregator);
  const parent = new Endpoint(type!, { id: "Heizstufe" });
  await aggregator.add(parent);
  const cavity = parent.parts.get("oven_cavity");
  expect(cavity).toBeDefined();
  if (!cavity) throw new Error("missing Oven cavity");
  await parent.act((agent) => {
    expect(
      agent
        .get(DescriptorServer)
        .state.deviceTypeList.some((d) => Number(d.deviceType) === 0x007b),
    ).toBe(true);
    expect(agent.get(DescriptorServer).state.partsList).toContain(
      cavity.number,
    );
  });
  await cavity.act(async (agent) => {
    const descriptor = agent.get(DescriptorServer).state;
    expect(
      descriptor.deviceTypeList.some((d) => Number(d.deviceType) === 0x0071),
    ).toBe(true);
    expect(descriptor.serverList.map(Number)).toContain(0x0049);
    const mode = agent.get(OvenStageModeServer);
    expect(mode.state.currentMode).toBe(2);
    expect(mode.state.supportedModes.map((m) => m.label)).toEqual([
      "Stufe 1",
      "Stufe 2",
      "Stufe 3",
      "Stufe 4",
      "Stufe 5",
    ]);
    expect((await mode.changeToMode({ newMode: 4 })).status).toBe(0);
    expect(mode.state.currentMode).toBe(4);
    expect((await mode.changeToMode({ newMode: 99 })).status).not.toBe(0);
    expect(mode.state.currentMode).toBe(4);
    const temperature = agent.get(VirtualOvenTemperatureServer);
    temperature.setTemperature({ targetTemperature: 2300 });
    expect(temperature.state.temperatureSetpoint).toBe(2300);
    expect(() =>
      temperature.setTemperature({ targetTemperature: 5001 }),
    ).toThrow();
    expect(temperature.state.temperatureSetpoint).toBe(2300);
    expect(mode.state.currentMode).toBe(4);
  });
  expect(calls).toEqual([
    {
      action: {
        action: "input_select.select_option",
        data: { option: "Stufe 4" },
      },
      target: stage().entity_id,
    },
  ]);
});
