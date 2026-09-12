import {
  type LightDeviceAttributes,
  LightDeviceColorMode,
} from "@home-assistant-matter-hub/common";
import type { EndpointType } from "@matter/main";
import { EntityStateProvider } from "../../../../services/bridges/entity-state-provider.js";
import { HaElectricalEnergyMeasurementServer } from "../../../behaviors/electrical-energy-measurement-server.js";
import { HaElectricalPowerMeasurementServer } from "../../../behaviors/electrical-power-measurement-server.js";
import { HomeAssistantEntityBehavior } from "../../../behaviors/home-assistant-entity-behavior.js";
import {
  buildSupportedModes,
  ModeSelectServer,
} from "../../../behaviors/mode-select-server.js";
import { HaPowerTopologyServer } from "../../../behaviors/power-topology-server.js";
import {
  DimmableLightType,
  DimmableLightWithBatteryType,
} from "./devices/dimmable-light.js";
import { ExtendedColorLightType } from "./devices/extended-color-light.js";
import {
  OnOffLightType,
  OnOffLightWithBatteryType,
} from "./devices/on-off-light-device.js";

const brightnessModes: LightDeviceColorMode[] = Object.values(
  LightDeviceColorMode,
)
  .filter((mode) => mode !== LightDeviceColorMode.UNKNOWN)
  .filter((mode) => mode !== LightDeviceColorMode.ONOFF);

const colorModes: LightDeviceColorMode[] = [
  LightDeviceColorMode.HS,
  LightDeviceColorMode.RGB,
  LightDeviceColorMode.XY,
  LightDeviceColorMode.RGBW,
  LightDeviceColorMode.RGBWW,
];

const LightModeSelectServer = ModeSelectServer({
  getOptions: (_, agent) =>
    agent.get(HomeAssistantEntityBehavior).state.mapping?.modeSelectOptions ??
    [],
  getCurrentOption: (_, agent) => {
    const entityId = agent.get(HomeAssistantEntityBehavior).state.mapping
      ?.modeSelectEntity;
    return entityId
      ? agent.env.get(EntityStateProvider).getState(entityId)?.state
      : undefined;
  },
  selectOption: (option, agent) => ({
    action: "select.select_option",
    data: { option },
    target: agent.get(HomeAssistantEntityBehavior).state.mapping
      ?.modeSelectEntity,
  }),
});

export function LightDevice(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType {
  const attributes = homeAssistantEntity.entity.state
    .attributes as LightDeviceAttributes & {
    battery?: number;
    battery_level?: number;
  };

  const supportedColorModes: LightDeviceColorMode[] =
    attributes.supported_color_modes ?? [];
  const supportsBrightness = supportedColorModes.some((mode) =>
    brightnessModes.includes(mode),
  );
  const supportsColorControl = supportedColorModes.some((mode) =>
    colorModes.includes(mode),
  );
  const supportsColorTemperature = supportedColorModes.includes(
    LightDeviceColorMode.COLOR_TEMP,
  );
  const hasBatteryAttr =
    attributes.battery_level != null || attributes.battery != null;
  const hasBatteryEntity = !!homeAssistantEntity.mapping?.batteryEntity;
  const hasBattery = hasBatteryAttr || hasBatteryEntity;

  // Use ExtendedColorLight for all color-capable lights, including ColorTemperature-only lights.
  // ColorTemperatureLightDevice has issues with Matter.js initialization that cause
  // "Behaviors have errors" during endpoint creation. ExtendedColorLight works correctly
  // with just the ColorTemperature feature enabled (supportsColorControl=false).
  const deviceType =
    supportsColorControl || supportsColorTemperature
      ? ExtendedColorLightType(
          supportsColorControl,
          supportsColorTemperature,
          hasBattery,
        )
      : supportsBrightness
        ? hasBattery
          ? DimmableLightWithBatteryType
          : DimmableLightType
        : hasBattery
          ? OnOffLightWithBatteryType
          : OnOffLightType;
  const hasPowerEntity = !!homeAssistantEntity.mapping?.powerEntity;
  const hasEnergyEntity = !!homeAssistantEntity.mapping?.energyEntity;
  // Voltage/current can be mapped on their own, so gate the power cluster on
  // any of the three or that data would be dropped.
  const hasElectricalPower =
    hasPowerEntity ||
    !!homeAssistantEntity.mapping?.voltageEntity ||
    !!homeAssistantEntity.mapping?.currentEntity;

  // biome-ignore lint/suspicious/noExplicitAny: Union type doesn't support .with() directly
  let device: any = deviceType;
  if (hasElectricalPower || hasEnergyEntity) {
    device = device.with(HaPowerTopologyServer);
  }
  if (hasElectricalPower) {
    device = device.with(HaElectricalPowerMeasurementServer);
  }
  if (hasEnergyEntity) {
    device = device.with(HaElectricalEnergyMeasurementServer);
  }

  const modeSelectOptions =
    homeAssistantEntity.mapping?.modeSelectOptions?.filter(Boolean) ?? [];
  if (
    homeAssistantEntity.mapping?.modeSelectEntity &&
    modeSelectOptions.length > 0
  ) {
    device = device.with(LightModeSelectServer).set({
      modeSelect: {
        description: homeAssistantEntity.mapping.modeSelectName ?? "Stufe",
        supportedModes: buildSupportedModes(modeSelectOptions),
        currentMode: 0,
      },
    });
  }

  return device.set({ homeAssistantEntity });
}
