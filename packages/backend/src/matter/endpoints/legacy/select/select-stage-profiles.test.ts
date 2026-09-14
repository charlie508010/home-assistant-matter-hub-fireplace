import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  EntityMappingConfig,
  HomeAssistantEntityInformation,
} from "@home-assistant-matter-hub/common";
import { Environment, VariableService } from "@matter/general";
import { Endpoint, VendorId } from "@matter/main";
import { ServerNode } from "@matter/main/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeDataProvider } from "../../../../services/bridges/bridge-data-provider.js";
import {
  type HomeAssistantAction,
  HomeAssistantActions,
} from "../../../../services/home-assistant/home-assistant-actions.js";
import { AggregatorEndpoint } from "../../aggregator-endpoint.js";
import { SelectDevice } from "./index.js";

const RAW_OPTIONS = ["C0", "C1", "C2", "C3", "C4", "C5"];
const LABELS = [
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
let server: ServerNode | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hamh-select-stage-profile-"));
  env = new Environment("test", Environment.default);
  env.get(VariableService).set("storage.path", dir);
  calls = [];
  env.set(HomeAssistantActions, {
    call(action: HomeAssistantAction) {
      calls.push(action);
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
      },
    } as never),
  );
});

afterEach(async () => {
  await server?.close().catch(() => {});
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function selectEntity(): HomeAssistantEntityInformation {
  return {
    entity_id: "select.kamin_matter_flammenfarbe",
    state: {
      entity_id: "select.kamin_matter_flammenfarbe",
      state: "C2",
      attributes: {
        friendly_name: "Kamin Matter Flammenfarbe",
        options: RAW_OPTIONS,
      } as never,
      context: { id: "ctx" },
      last_changed: "2026-01-01T00:00:00",
      last_updated: "2026-01-01T00:00:00",
    },
  };
}

async function mount(
  matterDeviceType: "mode_select" | "speaker" | "basic_video_player" | "fan",
  customName: string,
) {
  const mapping: EntityMappingConfig = {
    entityId: "select.kamin_matter_flammenfarbe",
    matterDeviceType,
    customName,
    modeSelectOptions: LABELS,
  };
  const type = SelectDevice({
    entity: selectEntity(),
    customName,
    mapping,
  } as never);
  if (!type) throw new Error(`No endpoint type for ${matterDeviceType}`);

  server = await ServerNode.create({
    environment: env as never,
    id: `stage-profile-${matterDeviceType}`,
    network: { port: 0 },
    commissioning: { passcode: 20202021, discriminator: 3840 },
    basicInformation: { vendorId: VendorId(0xfff1), productId: 0x8000 },
  });
  const aggregator = new AggregatorEndpoint("aggregator");
  await server.add(aggregator);
  const endpoint = new Endpoint(type, { id: matterDeviceType });
  await aggregator.add(endpoint);
  return endpoint;
}

function selectedOptions() {
  return calls
    .filter((call) => call.action === "select.select_option")
    .map((call) => (call.data as { option?: string }).option);
}

describe("select Matter stage compatibility profiles", () => {
  it("exposes a named Mode Select with custom Stufe labels", async () => {
    const endpoint = await mount("mode_select", "Flammenfarbe Modus");
    await endpoint.act((agent) => {
      // biome-ignore lint/suspicious/noExplicitAny: inspect live Matter state
      const a = agent as any;
      expect(a.bridgedDeviceBasicInformation.state.nodeLabel).toBe(
        "Flammenfarbe Modus",
      );
      expect(
        a.descriptor.state.deviceTypeList.map((entry: { deviceType: number }) =>
          Number(entry.deviceType),
        ),
      ).toContain(0x0027);
      expect(
        a.modeSelect.state.supportedModes.map(
          (mode: { label: string }) => mode.label,
        ),
      ).toEqual(LABELS);
      expect(a.modeSelect.state.currentMode).toBe(2);
      a.modeSelect.changeToMode({ newMode: 4 });
    });
    expect(selectedOptions()).toContain("C4");
  });

  it("exposes named Stufe inputs on a Basic Video Player", async () => {
    const endpoint = await mount(
      "basic_video_player",
      "Flammenfarbe Fernseher",
    );
    await endpoint.act((agent) => {
      // biome-ignore lint/suspicious/noExplicitAny: inspect live Matter state
      const a = agent as any;
      expect(a.bridgedDeviceBasicInformation.state.nodeLabel).toBe(
        "Flammenfarbe Fernseher",
      );
      expect(
        a.descriptor.state.deviceTypeList.map((entry: { deviceType: number }) =>
          Number(entry.deviceType),
        ),
      ).toContain(0x0028);
      expect(
        a.mediaInput.state.inputList.map(
          (input: { name: string }) => input.name,
        ),
      ).toEqual(LABELS);
      expect(a.mediaInput.state.currentInput).toBe(2);
      a.mediaInput.selectInput({ index: 5 });
    });
    expect(selectedOptions()).toContain("C5");
  });

  it("exposes a named Speaker with six snapped levels", async () => {
    const endpoint = await mount("speaker", "Flammenfarbe Stereo");
    await endpoint.act((agent) => {
      // biome-ignore lint/suspicious/noExplicitAny: inspect and drive live Matter state
      const a = agent as any;
      expect(a.bridgedDeviceBasicInformation.state.nodeLabel).toBe(
        "Flammenfarbe Stereo",
      );
      expect(
        a.descriptor.state.deviceTypeList.map((entry: { deviceType: number }) =>
          Number(entry.deviceType),
        ),
      ).toContain(0x0022);
      expect(a.levelControl.state.currentLevel).toBe(102);
      a.levelControl.moveToLevelLogic(203);
    });
    expect(selectedOptions()).toContain("C4");
  });

  it("exposes a named Fan with six discrete speeds", async () => {
    const endpoint = await mount("fan", "Flammenfarbe Ventilator");
    await endpoint.act((agent) => {
      // biome-ignore lint/suspicious/noExplicitAny: inspect live Matter state
      const a = agent as any;
      expect(a.bridgedDeviceBasicInformation.state.nodeLabel).toBe(
        "Flammenfarbe Ventilator",
      );
      expect(
        a.descriptor.state.deviceTypeList.map((entry: { deviceType: number }) =>
          Number(entry.deviceType),
        ),
      ).toContain(0x002b);
      expect(a.fanControl.state.speedMax).toBe(5);
      expect(a.fanControl.state.speedCurrent).toBe(2);
      const action = a.fanControl.state.config.turnOn(80, a);
      a.homeAssistantEntity.callAction(action);
    });
    expect(selectedOptions()).toContain("C4");
  });
});
