import type { HomeAssistantEntityInformation } from "@home-assistant-matter-hub/common";
import { Logger } from "@matter/general";
import { Behavior, Endpoint, type EndpointType } from "@matter/main";
import {
  OvenModeServer as BaseOvenModeServer,
  TemperatureControlServer,
} from "@matter/main/behaviors";
import { ModeBase } from "@matter/main/clusters/mode-base";
import { OvenMode } from "@matter/main/clusters/oven-mode";
import type { TemperatureControl } from "@matter/main/clusters/temperature-control";
import {
  OvenDevice,
  TemperatureControlledCabinetDevice,
} from "@matter/main/devices";
import { DatatypeModel, FieldElement } from "@matter/main/model";
import { StatusCode, StatusResponseError } from "@matter/main/types";
import { applyPatchState } from "../../../../utils/apply-patch-state.js";
import { BasicInformationServer } from "../../../behaviors/basic-information-server.js";
import { HomeAssistantEntityBehavior } from "../../../behaviors/home-assistant-entity-behavior.js";
import { IdentifyServer } from "../../../behaviors/identify-server.js";

const logger = Logger.get("OvenStageTest");

// Internal nonvolatile memory, not a vendor cluster or controller capability.
export class VirtualOvenMemory extends Behavior {
  static override readonly id = "virtualOvenMemory";
  static override readonly schema = new DatatypeModel(
    { name: "VirtualOvenMemoryState", type: "struct" },
    FieldElement({
      name: "temperatureSetpoint",
      type: "int16",
      quality: "N",
      default: 2100,
    }),
  );
  declare state: VirtualOvenMemory.State;
}

export namespace VirtualOvenMemory {
  export class State {
    temperatureSetpoint = 2100;
  }
}

const VirtualTemperatureBase =
  TemperatureControlServer.with("TemperatureNumber");

export class VirtualOvenTemperatureServer extends VirtualTemperatureBase {
  declare state: VirtualOvenTemperatureServer.State;
  override async initialize() {
    await super.initialize();
    const memory = await this.agent.load(VirtualOvenMemory);
    applyPatchState(this.state, {
      temperatureSetpoint: memory.state.temperatureSetpoint,
    });
  }
  override setTemperature(request: TemperatureControl.SetTemperatureRequest) {
    const target = request.targetTemperature;
    if (
      target == null ||
      !Number.isInteger(target) ||
      target < this.state.minTemperature ||
      target > this.state.maxTemperature
    ) {
      throw new StatusResponseError(
        "Invalid virtual cabinet temperature",
        StatusCode.ConstraintError,
      );
    }
    applyPatchState(this.state, { temperatureSetpoint: target });
    applyPatchState(this.agent.get(VirtualOvenMemory).state, {
      temperatureSetpoint: target,
    });
  }
}

export namespace VirtualOvenTemperatureServer {
  export class State extends VirtualTemperatureBase.State {
    override temperatureSetpoint = 2100;
  }
}

/** Five virtual bake-intensity variants, not a physical oven or heater. */
export function ovenStageOptions(
  entity: HomeAssistantEntityInformation,
): string[] {
  const options = (entity.state.attributes as { options?: unknown }).options;
  if (!Array.isArray(options))
    throw new Error("Oven stage test requires select options");
  const stages = options.filter(
    (option): option is string =>
      typeof option === "string" && /^Stufe [1-5]$/.test(option),
  );
  if (stages.length !== 5 || new Set(stages).size !== 5)
    throw new Error("Oven stage test requires Stufe 1 through Stufe 5");
  return stages.sort();
}

export class OvenStageModeServer extends BaseOvenModeServer {
  override async initialize() {
    await super.initialize();
    const homeAssistant = await this.agent.load(HomeAssistantEntityBehavior);
    this.update(homeAssistant.entity);
    this.reactTo(homeAssistant.onChange, this.update, {
      offline: true,
      lock: true,
    });
  }

  private update(entity: HomeAssistantEntityInformation) {
    const index = ovenStageOptions(entity).indexOf(entity.state.state);
    if (index >= 0) applyPatchState(this.state, { currentMode: index + 1 });
  }

  override async changeToMode(request: ModeBase.ChangeToModeRequest) {
    const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
    homeAssistant.assertAvailable();
    const oldMode = this.state.currentMode;
    const result = await super.changeToMode(request);
    if (result.status === ModeBase.ModeChangeStatus.Success) {
      const option = ovenStageOptions(homeAssistant.entity)[
        request.newMode - 1
      ];
      const domain = homeAssistant.entityId.split(".")[0];
      homeAssistant.callAction({
        action: `${domain}.select_option`,
        data: { option },
      });
      logger.info(
        `[MATTER][HEAT_MODE] Oven ChangeToMode: entity=${homeAssistant.entityId}, old=${oldMode}, new=${request.newMode}, option="${option}"`,
      );
    }
    return result;
  }
}

export function ovenStageCavityType(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  const options = ovenStageOptions(homeAssistantEntity.entity);
  const index = options.indexOf(homeAssistantEntity.entity.state.state);
  return TemperatureControlledCabinetDevice.with(
    HomeAssistantEntityBehavior,
    IdentifyServer,
    VirtualOvenMemory,
    VirtualOvenTemperatureServer,
    OvenStageModeServer,
  ).set({
    homeAssistantEntity,
    // Required cabinet temperature control is virtual and disconnected from the real thermostat.
    temperatureControl: { minTemperature: 0, maxTemperature: 5000 },
    ovenMode: {
      currentMode: index >= 0 ? index + 1 : 1,
      supportedModes: options.map((label, i) => ({
        label,
        mode: i + 1,
        modeTags: [{ value: OvenMode.ModeTag.Bake }],
      })),
    },
  });
}

export class OvenStageComposition extends Behavior {
  static override readonly id = "ovenStageComposition";
  static override readonly early = true;
  declare state: OvenStageComposition.State;

  override async initialize() {
    const homeAssistant = await this.agent.load(HomeAssistantEntityBehavior);
    // Endpoint.add awaits this parent's construction and would deadlock here.
    // Behavior initialization can run again on an already populated parent.
    // Retain the existing child, its endpoint number and its persisted state.
    if (!this.endpoint.parts.get("oven_cavity")) {
      this.endpoint.parts.add(
        new Endpoint(
          ovenStageCavityType({
            ...this.state.homeAssistantEntity,
            entity: homeAssistant.entity,
          }),
          { id: "oven_cavity" },
        ),
      );
    }
    this.reactTo(homeAssistant.onChange, this.updateCavity, {
      offline: true,
      lock: true,
    });
  }

  private async updateCavity(entity: HomeAssistantEntityInformation) {
    const cavity = this.endpoint.parts.get("oven_cavity");
    if (cavity)
      await cavity.setStateOf(HomeAssistantEntityBehavior, { entity });
  }
}

export namespace OvenStageComposition {
  export class State {
    homeAssistantEntity!: HomeAssistantEntityBehavior.State;
  }
}

export function OvenStageTestDevice(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  const domain = homeAssistantEntity.entity.entity_id.split(".")[0];
  if (domain !== "select" && domain !== "input_select")
    throw new Error(
      "Oven stage test is only supported for select/input_select",
    );
  ovenStageOptions(homeAssistantEntity.entity);
  return OvenDevice.with(
    BasicInformationServer,
    HomeAssistantEntityBehavior,
    IdentifyServer,
    OvenStageComposition,
  ).set({
    homeAssistantEntity,
    ovenStageComposition: { homeAssistantEntity },
  });
}
