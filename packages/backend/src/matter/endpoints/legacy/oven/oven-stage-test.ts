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
import { StatusCode, StatusResponseError } from "@matter/main/types";
import { applyPatchState } from "../../../../utils/apply-patch-state.js";
import { BasicInformationServer } from "../../../behaviors/basic-information-server.js";
import { HomeAssistantEntityBehavior } from "../../../behaviors/home-assistant-entity-behavior.js";
import { IdentifyServer } from "../../../behaviors/identify-server.js";

const logger = Logger.get("OvenStageTest");

export class VirtualOvenTemperatureServer extends TemperatureControlServer.with(
  "TemperatureNumber",
) {
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
    VirtualOvenTemperatureServer,
    OvenStageModeServer,
  ).set({
    homeAssistantEntity,
    // Required cabinet temperature control is virtual and disconnected from the real thermostat.
    temperatureControl: {
      temperatureSetpoint: 2100,
      minTemperature: 0,
      maxTemperature: 5000,
    },
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

// biome-ignore lint/correctness/noUnusedVariables: namespace merge used by endpoint factory
class OvenStageComposition extends Behavior {
  static override readonly id = "ovenStageComposition";
  static override readonly early = true;
  declare state: OvenStageComposition.State;

  override async initialize() {
    // Endpoint.add awaits this parent's construction and would deadlock here.
    this.endpoint.parts.add(
      new Endpoint(ovenStageCavityType(this.state.homeAssistantEntity), {
        id: "oven_cavity",
      }),
    );
  }
}

namespace OvenStageComposition {
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
