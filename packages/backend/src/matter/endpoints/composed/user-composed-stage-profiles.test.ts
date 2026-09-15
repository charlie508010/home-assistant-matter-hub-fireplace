import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  HomeAssistantEntityInformation,
  HomeAssistantEntityState,
} from "@home-assistant-matter-hub/common";
import { Environment, VariableService } from "@matter/general";
import { VendorId } from "@matter/main";
import { ServerNode } from "@matter/main/node";
import { describe, expect, it } from "vitest";
import { BridgeDataProvider } from "../../../services/bridges/bridge-data-provider.js";
import { EntityStateProvider } from "../../../services/bridges/entity-state-provider.js";
import { HomeAssistantActions } from "../../../services/home-assistant/home-assistant-actions.js";
import { HomeAssistantConfig } from "../../../services/home-assistant/home-assistant-config.js";
import { HomeAssistantEntityBehavior } from "../../behaviors/home-assistant-entity-behavior.js";
import { AggregatorEndpoint } from "../aggregator-endpoint.js";
import { UserComposedEndpoint } from "./user-composed-endpoint.js";

const LIGHT = "light.kamin";
const SELECT = "select.kamin_matter_flammenfarbe";
const POWER = "switch.kamin_ein_aus";
const TEMPERATURE = "sensor.kamin_ist_temperatur";
const labels = Array.from({ length: 6 }, (_, index) => `Stufe ${index}`);

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

describe("composed select stage compatibility profiles", () => {
  it("keeps four profiles of one HA select as distinct named endpoints", async () => {
    const states: Record<string, HomeAssistantEntityState> = {
      [LIGHT]: state(LIGHT, "on", {
        friendly_name: "Kamin",
        supported_color_modes: ["onoff"],
        color_mode: "onoff",
      }),
      [SELECT]: state(SELECT, "C2", {
        friendly_name: "Flammenfarbe",
        options: ["C0", "C1", "C2", "C3", "C4", "C5"],
      }),
    };
    const registry = {
      initialStateIncludingUnfiltered: (entityId: string) => states[entityId],
      entityIncludingUnfiltered: (entityId: string) => ({
        entity_id: entityId,
      }),
      deviceOfIncludingUnfiltered: () => undefined,
      isVacuumOnOffEnabled: () => false,
      isComposedPrimaryOnParentEnabled: () => true,
    };
    const endpoint = await UserComposedEndpoint.create({
      registry: registry as never,
      primaryEntityId: LIGHT,
      mapping: {
        entityId: LIGHT,
        customName: "Kamin",
        modeSelectEntity: SELECT,
        modeSelectOptions: labels,
      },
      composedEntities: [
        {
          entityId: SELECT,
          matterDeviceType: "mode_select",
          customName: "Flammenfarbe Modus",
        },
        {
          entityId: SELECT,
          matterDeviceType: "basic_video_player",
          customName: "Flammenfarbe Fernseher",
        },
        {
          entityId: SELECT,
          matterDeviceType: "speaker",
          customName: "Flammenfarbe Stereo",
        },
        {
          entityId: SELECT,
          matterDeviceType: "fan",
          customName: "Flammenfarbe Ventilator",
        },
      ],
      customName: "Kamin",
    });

    expect(endpoint).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "hamh-stage-profiles-"));
    const env = new Environment("test", Environment.default);
    env.get(VariableService).set("storage.path", dir);
    env.set(
      BridgeDataProvider,
      new BridgeDataProvider({
        id: "stage-profile-composition",
        name: "Kamin Matter",
        port: 0,
        filter: { include: [], exclude: [], includeMode: "any" },
        basicInformation: {
          vendorId: 0xfff1,
          vendorName: "Test",
          productName: "Test",
          productLabel: "Test",
          hardwareVersion: 1,
          softwareVersion: 1,
        },
      } as never),
    );
    env.set(EntityStateProvider, {
      getState: (entityId: string) => states[entityId],
    } as never);
    env.set(HomeAssistantConfig, {
      unitSystem: { temperature: "°C" },
    } as never);
    env.set(HomeAssistantActions, { call() {}, fireEvent() {} } as never);
    const server = await ServerNode.create({
      environment: env as never,
      id: "stage-profile-composition",
      network: { port: 0 },
      commissioning: { passcode: 20202021, discriminator: 3840 },
      basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
    });
    const aggregator = new AggregatorEndpoint("aggregator");
    await server.add(aggregator);
    await aggregator.add(endpoint!);

    const parts = [...endpoint!.parts];
    expect(parts).toHaveLength(4);

    const statesByPart = parts.map((part) =>
      part.stateOf(HomeAssistantEntityBehavior),
    );
    expect(statesByPart.map((part) => part.customName)).toEqual([
      "Flammenfarbe Modus",
      "Flammenfarbe Fernseher",
      "Flammenfarbe Stereo",
      "Flammenfarbe Ventilator",
    ]);
    expect(statesByPart.map((part) => part.mapping?.modeSelectOptions)).toEqual(
      [labels, labels, labels, labels],
    );

    const anchors = statesByPart.map(
      (part) => part.identityAnchor ?? part.entity.entity_id,
    );
    expect(new Set(anchors).size).toBe(4);
    expect(
      statesByPart.map(
        (part) => (part.entity as HomeAssistantEntityInformation).entity_id,
      ),
    ).toEqual([SELECT, SELECT, SELECT, SELECT]);

    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("mounts a standalone Laundry Washer with power and temperature children in server mode", async () => {
    const states: Record<string, HomeAssistantEntityState> = {
      [SELECT]: state(SELECT, "C2", {
        friendly_name: "Flammenfarbe",
        options: ["C0", "C1", "C2", "C3", "C4", "C5"],
      }),
      [POWER]: state(POWER, "on", { friendly_name: "Kamin Power" }),
      [TEMPERATURE]: state(TEMPERATURE, "23", {
        friendly_name: "Kamin Temperatur",
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
    };
    const registry = {
      initialStateIncludingUnfiltered: (entityId: string) => states[entityId],
      entityIncludingUnfiltered: (entityId: string) => ({
        entity_id: entityId,
      }),
      deviceOfIncludingUnfiltered: () => undefined,
      isVacuumOnOffEnabled: () => false,
      isComposedPrimaryOnParentEnabled: () => true,
    };
    const endpoint = await UserComposedEndpoint.create({
      registry: registry as never,
      primaryEntityId: SELECT,
      mapping: {
        entityId: SELECT,
        matterDeviceType: "laundry_washer",
        customName: "Kamin Washer Multi",
        modeSelectOptions: labels,
        powerSwitchEntity: POWER,
        operationalStateEntity: POWER,
        temperatureEntity: TEMPERATURE,
      },
      composedEntities: [
        {
          entityId: POWER,
          matterDeviceType: "on_off_plugin_unit",
          customName: "Kamin Power",
        },
        {
          entityId: TEMPERATURE,
          matterDeviceType: "temperature_sensor",
          customName: "Kamin Temperatur",
        },
      ],
      customName: "Kamin Washer Multi",
      standalone: true,
    });

    expect(endpoint).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "hamh-washer-multi-"));
    const env = new Environment("test", Environment.default);
    env.get(VariableService).set("storage.path", dir);
    env.set(
      BridgeDataProvider,
      new BridgeDataProvider({
        id: "washer-multi",
        name: "Kamin Washer Multi",
        port: 0,
        filter: { include: [], exclude: [], includeMode: "any" },
        basicInformation: {
          vendorId: 0xfff1,
          vendorName: "Test",
          productName: "Test",
          productLabel: "Test",
          hardwareVersion: 1,
          softwareVersion: 1,
        },
      } as never),
    );
    env.set(EntityStateProvider, {
      getState: (entityId: string) => states[entityId],
    } as never);
    env.set(HomeAssistantActions, { call() {}, fireEvent() {} } as never);
    env.set(HomeAssistantConfig, {
      unitSystem: { temperature: "°C" },
    } as never);
    const server = await ServerNode.create({
      environment: env as never,
      id: "washer-multi",
      network: { port: 0 },
      commissioning: { passcode: 20202021, discriminator: 3840 },
      basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
    });
    await server.add(endpoint!);

    await endpoint!.act((agent) => {
      // biome-ignore lint/suspicious/noExplicitAny: inspect live Matter state
      const a = agent as any;
      expect(
        a.descriptor.state.deviceTypeList.map((entry: { deviceType: number }) =>
          Number(entry.deviceType),
        ),
      ).toContain(0x0073);
      expect(a.onOff.state.onOff).toBe(true);
      expect(a.operationalState.state.operationalState).toBe(1);
      expect(a.temperatureMeasurement.state.measuredValue).toBe(2300);
      expect(
        a.laundryWasherMode.state.supportedModes.map(
          (mode: { label: string }) => mode.label,
        ),
      ).toEqual(labels);
    });
    expect([...endpoint!.parts]).toHaveLength(2);

    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
