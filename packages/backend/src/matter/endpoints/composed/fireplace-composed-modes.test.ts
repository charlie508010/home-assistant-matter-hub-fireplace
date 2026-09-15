import {
  type HomeAssistantEntityState,
  HomeAssistantMatcherType,
  LightDeviceColorMode,
} from "@home-assistant-matter-hub/common";
import { Environment, VariableService } from "@matter/general";
import { VendorId } from "@matter/main";
import { ServerNode } from "@matter/main/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeDataProvider } from "../../../services/bridges/bridge-data-provider.js";
import { BridgeRegistry } from "../../../services/bridges/bridge-registry.js";
import { EntityStateProvider } from "../../../services/bridges/entity-state-provider.js";
import { HomeAssistantActions } from "../../../services/home-assistant/home-assistant-actions.js";
import { HomeAssistantConfig } from "../../../services/home-assistant/home-assistant-config.js";
import type {
  HomeAssistantRegistry,
  HomeAssistantStates,
} from "../../../services/home-assistant/home-assistant-registry.js";
import { HomeAssistantEntityBehavior } from "../../behaviors/home-assistant-entity-behavior.js";
import { AggregatorEndpoint } from "../aggregator-endpoint.js";
import { UserComposedEndpoint } from "./user-composed-endpoint.js";

const LIGHT = "light.kamin";
const HEATER = "climate.kamin_heizung";
const HEAT_STAGE = "input_select.kamin_matter_heizstufe_test";
const FLAME = "select.kamin_matter_flamme_test";
const FLAME_COLOR = "select.kamin_matter_flammenfarbe";
const FLAME_BRIGHTNESS = "select.kamin_matter_flammenhelligkeit";

function state(
  entityId: string,
  value: string,
  attributes: Record<string, unknown>,
): HomeAssistantEntityState {
  return {
    entity_id: entityId,
    state: value,
    attributes,
    context: { id: "ctx" },
    last_changed: "2026-01-01T00:00:00",
    last_updated: "2026-01-01T00:00:00",
  };
}

function fireplaceTest1States(): HomeAssistantStates {
  const labels = Array.from({ length: 5 }, (_, i) => `Stufe ${i + 1}`);
  return {
    [HEATER]: state(HEATER, "off", {
      friendly_name: "Kamin Heizung",
      supported_features: 145,
      hvac_modes: ["off", "heat"],
      min_temp: 0,
      max_temp: 37,
      target_temp_step: 1,
      current_temperature: 23,
      temperature: 23,
    }),
    [HEAT_STAGE]: state(HEAT_STAGE, "Stufe 2", {
      friendly_name: "Heizstufe",
      options: ["Off", ...labels],
    }),
    [FLAME]: state(FLAME, "Stufe 4", {
      friendly_name: "Flamme",
      options: labels,
    }),
  };
}

function fireplaceStates(): HomeAssistantStates {
  const options0to5 = Array.from({ length: 6 }, (_, i) => `Stufe ${i}`);
  const options1to5 = Array.from({ length: 5 }, (_, i) => `Stufe ${i + 1}`);
  return {
    [LIGHT]: state(LIGHT, "on", {
      friendly_name: "Kamin",
      supported_color_modes: [LightDeviceColorMode.BRIGHTNESS],
      color_mode: LightDeviceColorMode.BRIGHTNESS,
      brightness: 128,
    }),
    [FLAME_COLOR]: state(FLAME_COLOR, "Stufe 3", {
      friendly_name: "Kamin Matter Flammenfarbe",
      options: options0to5,
    }),
    [FLAME_BRIGHTNESS]: state(FLAME_BRIGHTNESS, "Stufe 2", {
      friendly_name: "Kamin Matter Flammenhelligkeit",
      options: options1to5,
    }),
  };
}

function dataProvider(): BridgeDataProvider {
  return new BridgeDataProvider({
    id: "b",
    name: "Kamin Matter",
    port: 0,
    filter: {
      include: [{ type: HomeAssistantMatcherType.Pattern, value: LIGHT }],
      exclude: [],
      includeMode: "any",
    },
    featureFlags: {
      autoComposedDevices: true,
      composedPrimaryOnParent: true,
    },
    basicInformation: {
      vendorId: 0xfff1,
      vendorName: "t",
      productName: "t",
      productLabel: "t",
      hardwareVersion: 1,
      softwareVersion: 1,
    },
  } as never);
}

function registry(): BridgeRegistry {
  const states = fireplaceStates();
  const entities = Object.fromEntries(
    Object.keys(states).map((entityId) => [entityId, { entity_id: entityId }]),
  );
  const ha = {
    entities,
    states,
    devices: {},
    labels: [],
    areas: new Map(),
  } as unknown as HomeAssistantRegistry;
  return new BridgeRegistry(ha, dataProvider());
}

let dir: string;
let env: Environment;
let server: ServerNode | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hamh-fireplace-composed-"));
  env = new Environment("test", Environment.default);
  env.get(VariableService).set("storage.path", dir);
  env.set(BridgeDataProvider, dataProvider());
  const states = fireplaceStates();
  env.set(EntityStateProvider, {
    getState: (entityId: string) => states[entityId],
  } as never);
  env.set(HomeAssistantActions, { call() {}, fireEvent() {} } as never);
  env.set(HomeAssistantConfig, {
    unitSystem: { temperature: "°C" },
  } as never);
});

afterEach(async () => {
  await server?.close().catch(() => {});
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("composed fireplace ModeSelect endpoints", () => {
  it("builds TEST 1 as Kamin Heizung with two generic five-stage ModeSelect parts", async () => {
    const labels = Array.from({ length: 5 }, (_, i) => `Stufe ${i + 1}`);
    const states = fireplaceTest1States();
    const entities = Object.fromEntries(
      Object.keys(states).map((entityId) => [
        entityId,
        { entity_id: entityId },
      ]),
    );
    const ha = {
      entities,
      states,
      devices: {},
      labels: [],
      areas: new Map(),
    } as unknown as HomeAssistantRegistry;
    const testRegistry = new BridgeRegistry(ha, dataProvider());

    const endpoint = await UserComposedEndpoint.create({
      registry: testRegistry,
      primaryEntityId: HEATER,
      mapping: {
        entityId: HEATER,
        matterDeviceType: "thermostat",
        customName: "Kamin Heizung",
      },
      composedEntities: [
        {
          entityId: HEAT_STAGE,
          matterDeviceType: "mode_select",
          customName: "Heizstufe",
          modeSelectOptions: labels,
        },
        {
          entityId: FLAME,
          matterDeviceType: "mode_select",
          customName: "Flamme",
          modeSelectOptions: labels,
        },
      ],
    });

    expect(endpoint).toBeDefined();
    server = await ServerNode.create({
      environment: env as never,
      id: "fireplace-test1-composed-modes",
      network: { port: 0 },
      commissioning: { passcode: 20202021, discriminator: 3840 },
      basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
    });
    const aggregator = new AggregatorEndpoint("aggregator");
    await server.add(aggregator);
    await aggregator.add(endpoint!);

    const parts = [...endpoint!.parts];
    expect(parts).toHaveLength(2);

    const heat = parts[0].state as unknown as {
      modeSelect: {
        description: string;
        supportedModes: { label: string; mode: number }[];
        currentMode: number;
      };
    };
    const flame = parts[1].state as unknown as {
      modeSelect: {
        description: string;
        supportedModes: { label: string; mode: number }[];
        currentMode: number;
      };
    };

    expect(heat.modeSelect.description).toBe("Heizstufe");
    expect(flame.modeSelect.description).toBe("Flamme");
    expect(heat.modeSelect.supportedModes.map((mode) => mode.label)).toEqual(
      labels,
    );
    expect(flame.modeSelect.supportedModes.map((mode) => mode.label)).toEqual(
      labels,
    );
    expect(heat.modeSelect.supportedModes.map((mode) => mode.mode)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(flame.modeSelect.supportedModes.map((mode) => mode.mode)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(heat.modeSelect.currentMode).toBe(2);
    expect(flame.modeSelect.currentMode).toBe(4);
  });

  it("keeps Flammenfarbe on the Kamin parent and names the second mode Flammenhelligkeit", async () => {
    const endpoint = await UserComposedEndpoint.create({
      registry: registry(),
      primaryEntityId: LIGHT,
      mapping: {
        entityId: LIGHT,
        customName: "Kamin",
        modeSelectEntity: FLAME_COLOR,
        modeSelectName: "Flammenfarbe",
        modeSelectOptions: Array.from({ length: 6 }, (_, i) => `Stufe ${i}`),
      },
      composedEntities: [
        {
          entityId: FLAME_BRIGHTNESS,
          matterDeviceType: "mode_select",
          customName: "Flammenhelligkeit",
        },
      ],
    });

    expect(endpoint).toBeDefined();
    server = await ServerNode.create({
      environment: env as never,
      id: "fireplace-composed-modes",
      network: { port: 0 },
      commissioning: { passcode: 20202021, discriminator: 3840 },
      basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
    });
    const aggregator = new AggregatorEndpoint("aggregator");
    await server.add(aggregator);
    await aggregator.add(endpoint!);

    expect(
      (endpoint!.state as unknown as { modeSelect: { description: string } })
        .modeSelect.description,
    ).toBe("Flammenfarbe");
    const parts = [...endpoint!.parts];
    expect(parts).toHaveLength(1);
    expect(parts[0].stateOf(HomeAssistantEntityBehavior).entity.entity_id).toBe(
      FLAME_BRIGHTNESS,
    );
    expect(
      (parts[0].state as unknown as { modeSelect: { description: string } })
        .modeSelect.description,
    ).toBe("Flammenhelligkeit");
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
