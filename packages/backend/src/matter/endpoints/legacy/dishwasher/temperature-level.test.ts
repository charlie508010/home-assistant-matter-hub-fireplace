import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HomeAssistantEntityInformation } from "@home-assistant-matter-hub/common";
import { Environment, VariableService } from "@matter/general";
import { Endpoint, VendorId } from "@matter/main";
import {
  DishwasherAlarm,
  DishwasherMode,
  ModeBase,
} from "@matter/main/clusters";
import { ServerNode } from "@matter/main/node";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BridgeDataProvider } from "../../../../services/bridges/bridge-data-provider.js";
import {
  type HomeAssistantAction,
  HomeAssistantActions,
} from "../../../../services/home-assistant/home-assistant-actions.js";
import { AggregatorEndpoint } from "../../aggregator-endpoint.js";
import { createLegacyEndpointType } from "../create-legacy-endpoint-type.js";
import { SelectDishwasherModeServerBase } from "../select/index.js";
import { SelectTemperatureLevelServer } from "./temperature-level.js";

const OPTIONS = [
  "Stufe 0",
  "Stufe 1",
  "Stufe 2",
  "Stufe 3",
  "Stufe 4",
  "Stufe 5",
];

let dir: string;
let env: Environment;
let server: ServerNode | undefined;
let calls: { action: HomeAssistantAction; target: string }[];

function entity(options = OPTIONS): HomeAssistantEntityInformation {
  return {
    entity_id: "select.kamin_matter_test_03",
    state: {
      entity_id: "select.kamin_matter_test_03",
      state: "Stufe 2",
      attributes: { friendly_name: "Flammen Farbe", options },
      context: { id: "test" },
      last_changed: "2026-09-16T00:00:00",
      last_updated: "2026-09-16T00:00:00",
    } as never,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hamh-temperature-level-"));
  calls = [];
  env = new Environment("test", Environment.default);
  env.get(VariableService).set("storage.path", dir);
  env.set(HomeAssistantActions, {
    call(action: HomeAssistantAction, target: string) {
      calls.push({ action, target });
    },
  } as never);
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
    } as never),
  );
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

it("refuses missing or reordered Stufe 0–5 options", () => {
  for (const options of [OPTIONS.slice(0, 5), [...OPTIONS].reverse()]) {
    expect(() =>
      createLegacyEndpointType(entity(options), {
        entityId: "select.kamin_matter_test_03",
        matterDeviceType: "dishwasher_temperature_level",
      }),
    ).toThrow("requires Stufe 0 through Stufe 5");
  }
});

it("offers only Stufe 1–5 as dishwasher modes and rejects invalid mode IDs", async () => {
  const type = createLegacyEndpointType(entity(), {
    entityId: "select.kamin_matter_test_03",
    matterDeviceType: "dishwasher_temperature_level",
    customName: "Flammen Farbe",
    modeSelectOptions: OPTIONS,
  });
  expect(type).toBeDefined();
  server = await ServerNode.create({
    environment: env as never,
    id: "temperature-level-test",
    network: { port: 0 },
    commissioning: { passcode: 20202021, discriminator: 3840 },
    basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
  });
  const aggregator = new AggregatorEndpoint("aggregator");
  await server.add(aggregator);
  const endpoint = new Endpoint(type!, { id: "flammenfarbe" });
  await aggregator.add(endpoint);

  await endpoint.act(async (agent) => {
    const stage = agent.get(SelectTemperatureLevelServer);
    const mode = agent.get(SelectDishwasherModeServerBase);
    expect(mode.state.supportedModes.map((entry) => entry.label)).toEqual(
      OPTIONS.slice(1),
    );
    expect(mode.state.supportedModes.map((entry) => entry.mode)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(mode.state.currentMode).toBe(2);
    expect(stage.state.supportedTemperatureLevels).toEqual(OPTIONS.slice(1));
    expect(stage.state.selectedTemperatureLevel).toBe(1);
    expect(
      agent.descriptor.state.deviceTypeList.map((d) => Number(d.deviceType)),
    ).toContain(0x75);
    expect(agent.descriptor.state.serverList.map(Number)).toContain(0x56);
    expect(agent.descriptor.state.serverList.map(Number)).toContain(
      Number(DishwasherMode.id),
    );
    expect(agent.descriptor.state.serverList.map(Number)).toContain(
      Number(DishwasherAlarm.id),
    );

    for (const level of [-1, 5, 6, 8, 2.5]) {
      expect(() =>
        stage.setTemperature({ targetTemperatureLevel: level }),
      ).toThrow();
    }
    expect(() => stage.setTemperature({ targetTemperature: 3000 })).toThrow();
    expect(stage.state.selectedTemperatureLevel).toBe(1);
    expect(calls).toHaveLength(0);

    for (const invalidMode of [0, 6, 8]) {
      const result = await mode.changeToMode({ newMode: invalidMode });
      expect(result.status).toBe(ModeBase.ModeChangeStatus.UnsupportedMode);
    }
    expect(calls).toHaveLength(0);

    const changed = await mode.changeToMode({ newMode: 4 });
    expect(changed.status).toBe(ModeBase.ModeChangeStatus.Success);
    expect(calls).toEqual([
      {
        target: "select.kamin_matter_test_03",
        action: {
          action: "select.select_option",
          data: { option: "Stufe 4" },
        },
      },
    ]);
    calls.length = 0;

    const highest = await mode.changeToMode({ newMode: 5 });
    expect(highest.status).toBe(ModeBase.ModeChangeStatus.Success);
    expect(calls).toEqual([
      {
        target: "select.kamin_matter_test_03",
        action: {
          action: "select.select_option",
          data: { option: "Stufe 5" },
        },
      },
    ]);
    calls.length = 0;

    stage.setTemperature({ targetTemperatureLevel: 3 });
    expect(stage.state.selectedTemperatureLevel).toBe(3);
  });
  expect(calls).toEqual([
    {
      target: "select.kamin_matter_test_03",
      action: {
        action: "select.select_option",
        data: { option: "Stufe 4" },
      },
    },
  ]);
});

it("exposes only dishwasher modes 1–5 for the real flame color and rejects 0 and 6+", async () => {
  const real = entity();
  real.entity_id = "select.kamin_flammenfarbe";
  real.state.entity_id = real.entity_id;
  const type = createLegacyEndpointType(real, {
    entityId: real.entity_id,
    matterDeviceType: "dishwasher_stage_mode_only",
    customName: "Flammenfarbe",
  });
  expect(type).toBeDefined();
  server = await ServerNode.create({
    environment: env as never,
    id: "flame-stage-mode-test",
    network: { port: 0 },
    commissioning: { passcode: 20202021, discriminator: 3840 },
    basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
  });
  const aggregator = new AggregatorEndpoint("aggregator");
  await server.add(aggregator);
  const endpoint = new Endpoint(type!, { id: "flammenfarbe" });
  await aggregator.add(endpoint);

  await endpoint.act(async (agent) => {
    const mode = agent.get(SelectDishwasherModeServerBase);
    expect(mode.state.supportedModes.map((entry) => entry.mode)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(mode.state.supportedModes.map((entry) => entry.label)).toEqual([
      "Stufe Eins",
      "Stufe Zwei",
      "Stufe Drei",
      "Stufe Vier",
      "Stufe Fünf",
    ]);
    expect(agent.descriptor.state.serverList.map(Number)).not.toContain(0x56);
    for (const invalidMode of [0, 6, 8]) {
      const result = await mode.changeToMode({ newMode: invalidMode });
      expect(result.status).toBe(ModeBase.ModeChangeStatus.UnsupportedMode);
    }
    expect(calls).toHaveLength(0);
    const result = await mode.changeToMode({ newMode: 5 });
    expect(result.status).toBe(ModeBase.ModeChangeStatus.Success);
  });
  expect(calls).toEqual([
    {
      target: "select.kamin_flammenfarbe",
      action: {
        action: "select.select_option",
        data: { option: "Stufe 5" },
      },
    },
  ]);
});
