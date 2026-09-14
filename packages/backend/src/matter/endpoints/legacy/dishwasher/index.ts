import type {
  HomeAssistantEntityInformation,
  SensorDeviceAttributes,
} from "@home-assistant-matter-hub/common";
import type { EndpointType } from "@matter/main";
import { OperationalStateServer as Base } from "@matter/main/behaviors/operational-state";
import { OperationalState } from "@matter/main/clusters/operational-state";
import { DishwasherDevice, LaundryWasherDevice } from "@matter/main/devices";
import { EntityStateProvider } from "../../../../services/bridges/entity-state-provider.js";
import { applyPatchState } from "../../../../utils/apply-patch-state.js";
import { Temperature } from "../../../../utils/converters/temperature.js";
import { BasicInformationServer } from "../../../behaviors/basic-information-server.js";
import { HomeAssistantEntityBehavior } from "../../../behaviors/home-assistant-entity-behavior.js";
import { IdentifyServer } from "../../../behaviors/identify-server.js";
import {
  defaultOnOffAction,
  OnOffServer,
} from "../../../behaviors/on-off-server.js";
import { TemperatureMeasurementServer } from "../../../behaviors/temperature-measurement-server.js";

const haStateToDishwasherState: Record<
  string,
  OperationalState.OperationalStateEnum
> = {
  off: OperationalState.OperationalStateEnum.Stopped,
  idle: OperationalState.OperationalStateEnum.Stopped,
  standby: OperationalState.OperationalStateEnum.Stopped,
  on: OperationalState.OperationalStateEnum.Running,
  running: OperationalState.OperationalStateEnum.Running,
  active: OperationalState.OperationalStateEnum.Running,
  drying: OperationalState.OperationalStateEnum.Running,
  washing: OperationalState.OperationalStateEnum.Running,
  paused: OperationalState.OperationalStateEnum.Paused,
  complete: OperationalState.OperationalStateEnum.Stopped,
  finished: OperationalState.OperationalStateEnum.Stopped,
};

class DishwasherOperationalStateServer extends Base {
  override async initialize() {
    this.state.operationalStateList = [
      { operationalStateId: OperationalState.OperationalStateEnum.Stopped },
      { operationalStateId: OperationalState.OperationalStateEnum.Running },
      { operationalStateId: OperationalState.OperationalStateEnum.Paused },
      { operationalStateId: OperationalState.OperationalStateEnum.Error },
    ];
    this.state.operationalState = OperationalState.OperationalStateEnum.Stopped;
    this.state.operationalError = {
      errorStateId: OperationalState.ErrorState.NoError,
    };

    await super.initialize();
    const homeAssistant = await this.agent.load(HomeAssistantEntityBehavior);
    this.update(homeAssistant.entity);
    this.reactTo(homeAssistant.onChange, this.update, { lock: true });
  }

  private update(entity: HomeAssistantEntityInformation) {
    if (!entity.state) {
      return;
    }
    const mapping = this.agent.get(HomeAssistantEntityBehavior).state.mapping;
    const statusEntity =
      mapping?.operationalStateEntity ?? mapping?.powerSwitchEntity;
    const source = statusEntity
      ? this.agent.env.get(EntityStateProvider).getState(statusEntity)
      : entity.state;
    const haState = source?.state?.toLowerCase() ?? "off";
    const newState =
      haStateToDishwasherState[haState] ??
      OperationalState.OperationalStateEnum.Stopped;
    applyPatchState(this.state, {
      operationalState: newState,
      operationalError: {
        errorStateId: OperationalState.ErrorState.NoError,
      },
    });
  }

  override pause(): OperationalState.OperationalCommandResponse {
    return {
      commandResponseState: {
        errorStateId: OperationalState.ErrorState.CommandInvalidInState,
      },
    };
  }

  override stop(): OperationalState.OperationalCommandResponse {
    const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
    const target = homeAssistant.state.mapping?.powerSwitchEntity;
    if (target) {
      homeAssistant.callActionForEntity(
        defaultOnOffAction(target, false),
        target,
      );
    }
    return {
      commandResponseState: {
        errorStateId: OperationalState.ErrorState.NoError,
      },
    };
  }

  override start(): OperationalState.OperationalCommandResponse {
    const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
    const target = homeAssistant.state.mapping?.powerSwitchEntity;
    if (target) {
      homeAssistant.callActionForEntity(
        defaultOnOffAction(target, true),
        target,
      );
    }
    return {
      commandResponseState: {
        errorStateId: OperationalState.ErrorState.NoError,
      },
    };
  }

  override resume(): OperationalState.OperationalCommandResponse {
    return this.start();
  }
}

function dishwasherOnOffServer(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
) {
  const target = homeAssistantEntity.mapping?.powerSwitchEntity;
  if (!target) {
    return OnOffServer({
      turnOn: () => ({ action: "homeassistant.turn_on" }),
      turnOff: () => ({ action: "homeassistant.turn_off" }),
    });
  }
  return OnOffServer({
    targetEntity: target,
    isOn: (_state, agent) => {
      const mapped = agent.env.get(EntityStateProvider).getState(target);
      return mapped?.state !== "off" && mapped?.state !== "unavailable";
    },
    turnOn: () => defaultOnOffAction(target, true),
    turnOff: () => defaultOnOffAction(target, false),
  });
}

function applianceEndpoint(
  device: typeof DishwasherDevice | typeof LaundryWasherDevice,
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  let type = device.with(
    BasicInformationServer,
    IdentifyServer,
    HomeAssistantEntityBehavior,
    DishwasherOperationalStateServer,
    dishwasherOnOffServer(homeAssistantEntity),
  );

  const temperatureEntity = homeAssistantEntity.mapping?.temperatureEntity;
  if (temperatureEntity) {
    type = type.with(
      TemperatureMeasurementServer({
        getValue: (_entity, agent) => {
          const state = agent.env
            .get(EntityStateProvider)
            .getState(temperatureEntity);
          if (!state || Number.isNaN(Number(state.state))) return undefined;
          return Temperature.withUnit(
            Number(state.state),
            (state.attributes as SensorDeviceAttributes).unit_of_measurement ??
              "°C",
          );
        },
      }),
    );
  }

  return type.set({ homeAssistantEntity } as never);
}

export function DishwasherEndpoint(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  return applianceEndpoint(DishwasherDevice, homeAssistantEntity);
}

export function LaundryWasherEndpoint(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  return applianceEndpoint(LaundryWasherDevice, homeAssistantEntity);
}
