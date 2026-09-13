import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type HomeAssistantEntityInformation,
  LightDeviceColorMode,
} from "@home-assistant-matter-hub/common";
import { Environment, VariableService } from "@matter/general";
import { Endpoint, VendorId } from "@matter/main";
import { ServerNode } from "@matter/main/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeDataProvider } from "../../../../services/bridges/bridge-data-provider.js";
import { EntityStateProvider } from "../../../../services/bridges/entity-state-provider.js";
import {
  type HomeAssistantAction,
  HomeAssistantActions,
} from "../../../../services/home-assistant/home-assistant-actions.js";
import { AggregatorEndpoint } from "../../aggregator-endpoint.js";
import { LightDevice } from "./index.js";

const modeEntityId = "select.kamin_matter_flammenfarbe";
const options = [
  "Stufe 0",
  "Stufe 1",
  "Stufe 2",
  "Stufe 3",
  "Stufe 4",
  "Stufe 5",
];

let dir: string;
let env: Environment;
let calls: HomeAssistantAction[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hamh-fireplace-mode-"));
  env = new Environment("test", Environment.default);
  env.get(VariableService).set("storage.path", dir);
  calls = [];
  env.set(HomeAssistantActions, {
    call(action: HomeAssistantAction) {
      calls.push(action);
    },
  } as never);
  env.set(EntityStateProvider, {
    getState(entityId: string) {
      return entityId === modeEntityId
        ? { state: "Stufe 3", attributes: { options } }
        : undefined;
    },
  } as never);
  env.set(
    BridgeDataProvider,
    new BridgeDataProvider({
      id: "b",
      name: "b",
      port: 0,
      filter: { include: [], exclude: [], includeMode: "any" },
      basicInformation: {
        vendorId: 0xfff1,
        vendorName: "t",
        productName: "t",
        productLabel: "t",
        hardwareVersion: 1,
        softwareVersion: 1,
      } as never,
    } as never),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fireplaceLight(): HomeAssistantEntityInformation {
  const state = {
    entity_id: "light.kamin",
    state: "on",
    attributes: {
      friendly_name: "Kamin",
      supported_color_modes: [LightDeviceColorMode.BRIGHTNESS],
      color_mode: LightDeviceColorMode.BRIGHTNESS,
      brightness: 128,
    },
    context: { id: "ctx" },
    last_changed: "2026-01-01T00:00:00",
    last_updated: "2026-01-01T00:00:00",
  };
  return { entity_id: "light.kamin", state: state as never };
}

describe("light with mapped ModeSelect", () => {
  it("exposes named stages and writes the selected stage to Home Assistant", async () => {
    const server = await ServerNode.create({
      environment: env as never,
      id: "fireplace-mode-node",
      network: { port: 0 },
      commissioning: { passcode: 20202021, discriminator: 3840 },
      basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
    });
    const aggregator = new AggregatorEndpoint("aggregator");
    await server.add(aggregator);
    const endpoint = new Endpoint(
      LightDevice({
        entity: fireplaceLight(),
        mapping: {
          entityId: "light.kamin",
          modeSelectEntity: modeEntityId,
          modeSelectName: "Flammenfarbe",
          modeSelectOptions: options,
        },
      }),
      { id: "kamin" },
    );
    await aggregator.add(endpoint);

    const deviceTypes = (
      endpoint.state.descriptor as {
        readonly deviceTypeList: readonly {
          readonly deviceType: number;
          readonly revision: number;
        }[];
      }
    ).deviceTypeList;
    expect(
      deviceTypes.map(({ deviceType, revision }) => [
        Number(deviceType),
        revision,
      ]),
    ).toEqual([
      [0x0100, 3],
      [0x0013, 3],
    ]);
    expect(endpoint.state.levelControl).toBeUndefined();

    const modeState = endpoint.state.modeSelect as {
      description: string;
      supportedModes: { label: string }[];
      currentMode: number;
    };
    expect(modeState.description).toBe("Flammenfarbe");
    expect(modeState.supportedModes.map((mode) => mode.label)).toEqual(options);
    expect(modeState.currentMode).toBe(3);

    await endpoint.act(async (agent) => {
      const modeSelect = agent.modeSelect as unknown as {
        changeToMode(request: { newMode: number }): Promise<void>;
      };
      await modeSelect.changeToMode({ newMode: 5 });
    });
    expect(calls.at(-1)).toEqual({
      action: "select.select_option",
      data: { option: "Stufe 5" },
      target: modeEntityId,
    });
    await server.close();
  });
});
