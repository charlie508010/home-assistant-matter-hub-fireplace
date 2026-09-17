import type { HomeAssistantEntityInformation } from "@home-assistant-matter-hub/common";
import type { EndpointType } from "@matter/main";
import { TemperatureControlServer } from "@matter/main/behaviors";
import { DishwasherAlarmServer } from "@matter/main/behaviors/dishwasher-alarm";
import { DishwasherAlarm } from "@matter/main/clusters/dishwasher-alarm";
import type { TemperatureControl } from "@matter/main/clusters/temperature-control";
import { StatusCode, StatusResponseError } from "@matter/main/types";
import { applyPatchState } from "../../../../utils/apply-patch-state.js";
import { HomeAssistantEntityBehavior } from "../../../behaviors/home-assistant-entity-behavior.js";
import { buildSelectDishwasherModeServer } from "../select/index.js";
import { DishwasherEndpoint } from "./index.js";

const STAGES = [
  "Stufe 0",
  "Stufe 1",
  "Stufe 2",
  "Stufe 3",
  "Stufe 4",
  "Stufe 5",
] as const;
const EXPOSED_STAGES: string[] = STAGES.slice(1);

function stageOptions(entity: HomeAssistantEntityInformation): string[] {
  const options = (entity.state.attributes as { options?: unknown }).options;
  if (
    !Array.isArray(options) ||
    options.length !== STAGES.length ||
    !STAGES.every((stage, index) => options[index] === stage)
  ) {
    throw new Error(
      "Dishwasher Temperature Level requires Stufe 0 through Stufe 5",
    );
  }
  return options;
}

const TemperatureLevelBase = TemperatureControlServer.with("TemperatureLevel");

export class SelectTemperatureLevelServer extends TemperatureLevelBase {
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
    stageOptions(entity);
    const stage = EXPOSED_STAGES.indexOf(entity.state.state);
    if (stage >= 0) {
      applyPatchState(this.state, { selectedTemperatureLevel: stage });
    }
  }

  override setTemperature(request: TemperatureControl.SetTemperatureRequest) {
    const level = request.targetTemperatureLevel;
    if (
      request.targetTemperature !== undefined ||
      level === undefined ||
      !Number.isInteger(level) ||
      level < 0 ||
      level >= this.state.supportedTemperatureLevels.length
    ) {
      throw new StatusResponseError(
        "Temperature level must be between 0 and 4",
        StatusCode.ConstraintError,
      );
    }

    const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
    homeAssistant.assertAvailable();
    stageOptions(homeAssistant.entity);
    const option = EXPOSED_STAGES[level];
    const domain = homeAssistant.entityId.split(".")[0];
    homeAssistant.callAction({
      action: `${domain}.select_option`,
      data: { option },
    });
    applyPatchState(this.state, { selectedTemperatureLevel: level });
  }
}

export function DishwasherTemperatureLevelDevice(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  const domain = homeAssistantEntity.entity.entity_id.split(".")[0];
  if (domain !== "select" && domain !== "input_select") {
    throw new Error(
      "Dishwasher Temperature Level requires select or input_select",
    );
  }
  stageOptions(homeAssistantEntity.entity);
  const supportedTemperatureLevels = EXPOSED_STAGES;
  const selectedTemperatureLevel = EXPOSED_STAGES.indexOf(
    homeAssistantEntity.entity.state.state,
  );
  const dishwasher = DishwasherEndpoint(homeAssistantEntity) as EndpointType & {
    with(...behaviors: unknown[]): EndpointType;
  };
  return dishwasher.with(
    buildSelectDishwasherModeServer(
      domain === "select"
        ? "select.select_option"
        : "input_select.select_option",
      homeAssistantEntity,
      EXPOSED_STAGES,
      1,
    ),
    DishwasherAlarmServer.set({
      mask: new DishwasherAlarm.Alarm(0),
      state: new DishwasherAlarm.Alarm(0),
      supported: new DishwasherAlarm.Alarm(0),
    }),
    SelectTemperatureLevelServer.set({
      supportedTemperatureLevels,
      selectedTemperatureLevel:
        selectedTemperatureLevel >= 0 ? selectedTemperatureLevel : 0,
    }),
  );
}

// Keep voice stage numbers unambiguous: Temperature Control would expose a
// second, zero-based range for the same physical setting.
export function DishwasherStageModeOnlyDevice(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  const domain = homeAssistantEntity.entity.entity_id.split(".")[0];
  if (domain !== "select" && domain !== "input_select") {
    throw new Error("Dishwasher Stage Mode requires select or input_select");
  }
  stageOptions(homeAssistantEntity.entity);
  const dishwasher = DishwasherEndpoint(homeAssistantEntity) as EndpointType & {
    with(...behaviors: unknown[]): EndpointType;
  };
  return dishwasher.with(
    buildSelectDishwasherModeServer(
      domain === "select"
        ? "select.select_option"
        : "input_select.select_option",
      homeAssistantEntity,
      EXPOSED_STAGES,
      1,
    ),
    DishwasherAlarmServer.set({
      mask: new DishwasherAlarm.Alarm(0),
      state: new DishwasherAlarm.Alarm(0),
      supported: new DishwasherAlarm.Alarm(0),
    }),
  );
}
