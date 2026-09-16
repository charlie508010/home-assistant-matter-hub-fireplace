import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HomeAssistantEntityInformation } from "@home-assistant-matter-hub/common";
import { Environment, VariableService } from "@matter/general";
import { Endpoint, VendorId } from "@matter/main";
import { ServerNode } from "@matter/main/node";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BridgeDataProvider } from "../../../../services/bridges/bridge-data-provider.js";
import {
  type HomeAssistantAction,
  HomeAssistantActions,
} from "../../../../services/home-assistant/home-assistant-actions.js";
import { AggregatorEndpoint } from "../../aggregator-endpoint.js";
import { createLegacyEndpointType } from "../create-legacy-endpoint-type.js";
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

it("exposes six Temperature Control levels and rejects out-of-range commands", async () => {
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

  await endpoint.act((agent) => {
    const stage = agent.get(SelectTemperatureLevelServer);
    expect(stage.state.supportedTemperatureLevels).toEqual(OPTIONS);
    expect(stage.state.selectedTemperatureLevel).toBe(2);
    expect(
      agent.descriptor.state.deviceTypeList.map((d) => Number(d.deviceType)),
    ).toContain(0x75);
    expect(agent.descriptor.state.serverList.map(Number)).toContain(0x56);

    for (const level of [-1, 6, 8, 2.5]) {
      expect(() =>
        stage.setTemperature({ targetTemperatureLevel: level }),
      ).toThrow();
    }
    expect(() => stage.setTemperature({ targetTemperature: 3000 })).toThrow();
    expect(stage.state.selectedTemperatureLevel).toBe(2);
    expect(calls).toHaveLength(0);

    stage.setTemperature({ targetTemperatureLevel: 4 });
    expect(stage.state.selectedTemperatureLevel).toBe(4);
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
