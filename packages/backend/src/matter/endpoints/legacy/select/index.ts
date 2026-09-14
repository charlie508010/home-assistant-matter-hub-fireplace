import type {
  HomeAssistantEntityInformation,
  HomeAssistantEntityState,
} from "@home-assistant-matter-hub/common";
import type { Agent, EndpointType } from "@matter/main";
import { GroupsServer, ScenesManagementServer } from "@matter/main/behaviors";
import { FanControl } from "@matter/main/clusters";
import {
  BasicVideoPlayerDevice,
  FanDevice as MatterFanDevice,
  ModeSelectDevice,
  OnOffLightDevice,
  OnOffPlugInUnitDevice,
  SpeakerDevice,
} from "@matter/main/devices";
import { BasicInformationServer } from "../../../behaviors/basic-information-server.js";
import { FanControlServer } from "../../../behaviors/fan-control-server.js";
import { HomeAssistantEntityBehavior } from "../../../behaviors/home-assistant-entity-behavior.js";
import { IdentifyServer } from "../../../behaviors/identify-server.js";
import { MediaInputServer } from "../../../behaviors/media-input-server.js";
import {
  buildSupportedModes,
  ModeSelectServer,
} from "../../../behaviors/mode-select-server.js";
import { OnOffServer } from "../../../behaviors/on-off-server.js";
import { SpeakerLevelControlServer } from "../../../behaviors/speaker-level-control-server.js";
import { MediaPlayerKeypadInputServer } from "../media-player/behaviors/media-player-keypad-input-server.js";
import { MediaPlayerMediaPlaybackServer } from "../media-player/behaviors/media-player-media-playback-server.js";

interface SelectAttributes {
  options?: string[];
}

type SelectAction = "select.select_option" | "input_select.select_option";

function getStateOptions(state: HomeAssistantEntityState): string[] {
  return (state.attributes as SelectAttributes).options ?? [];
}

function getSelectOptions(entity: HomeAssistantEntityInformation): string[] {
  return getStateOptions(entity.state);
}

function getDisplayOptions(state: HomeAssistantEntityState, agent: Agent) {
  const options = getStateOptions(state);
  const labels = agent.get(HomeAssistantEntityBehavior).state.mapping
    ?.modeSelectOptions;
  return labels?.length === options.length ? labels : options;
}

function selectOptionAction(action: SelectAction, option: string) {
  return { action, data: { option } };
}

function optionAtPercent(state: HomeAssistantEntityState, percent: number) {
  const options = getStateOptions(state);
  const index = Math.round(
    (Math.max(0, Math.min(100, percent)) / 100) *
      Math.max(0, options.length - 1),
  );
  return options[index] ?? options[0] ?? "";
}

function currentPercent(state: HomeAssistantEntityState) {
  const options = getStateOptions(state);
  if (options.length <= 1) return 0;
  const index = options.findIndex(
    (option) => option.toLowerCase() === state.state?.toLowerCase(),
  );
  return (Math.max(0, index) / (options.length - 1)) * 100;
}

function buildSelectModeServer(action: string) {
  return ModeSelectServer({
    getOptions: getSelectOptions,
    getLabels: (entity, agent) => {
      const options = getSelectOptions(entity);
      const labels = agent.get(HomeAssistantEntityBehavior).state.mapping
        ?.modeSelectOptions;
      return labels?.length === options.length ? labels : options;
    },
    getCurrentOption: (entity) => entity.state.state ?? undefined,
    selectOption: (option) => ({
      action,
      data: { option },
    }),
  });
}

const SelectModeServer = buildSelectModeServer("select.select_option");
const InputSelectModeServer = buildSelectModeServer(
  "input_select.select_option",
);

function buildSelectMediaInputServer(action: SelectAction) {
  return MediaInputServer({
    getCurrentSource: (state) => state.state ?? undefined,
    getSourceList: getStateOptions,
    getSourceLabels: getDisplayOptions,
    selectSource: (option) => selectOptionAction(action, option),
  });
}

function buildStageOnOffServer(action: SelectAction) {
  return OnOffServer({
    isOn: (state) => currentPercent(state) > 0,
    turnOn: (_, agent) => {
      const state = agent.get(HomeAssistantEntityBehavior).entity.state;
      const options = getStateOptions(state);
      return selectOptionAction(action, options[1] ?? options[0] ?? "");
    },
    turnOff: (_, agent) => {
      const state = agent.get(HomeAssistantEntityBehavior).entity.state;
      return selectOptionAction(action, getStateOptions(state)[0] ?? "");
    },
  });
}

function buildSelectSpeakerLevelServer(action: SelectAction) {
  return SpeakerLevelControlServer({
    getValuePercent: (state) => currentPercent(state) / 100,
    moveToLevelPercent: (value, agent) =>
      selectOptionAction(
        action,
        optionAtPercent(
          agent.get(HomeAssistantEntityBehavior).entity.state,
          value * 100,
        ),
      ),
  });
}

function currentStageAction(action: SelectAction, agent: Agent) {
  const state = agent.get(HomeAssistantEntityBehavior).entity.state;
  return selectOptionAction(
    action,
    state.state ?? getStateOptions(state)[0] ?? "",
  );
}

function buildSelectFanControlServer(action: SelectAction) {
  return FanControlServer({
    getPercentage: currentPercent,
    getStepSize: (state) => {
      const count = getStateOptions(state).length;
      return count > 1 ? 100 / (count - 1) : 100;
    },
    getAirflowDirection: () => FanControl.AirflowDirection.Forward,
    isInAutoMode: () => false,
    getPresetModes: () => undefined,
    getCurrentPresetMode: () => undefined,
    supportsPercentage: () => true,
    isOscillating: () => false,
    supportsOscillation: () => false,
    getWindMode: () => undefined,
    supportsWind: () => false,
    turnOff: (_, agent) => {
      const state = agent.get(HomeAssistantEntityBehavior).entity.state;
      return selectOptionAction(action, getStateOptions(state)[0] ?? "");
    },
    turnOn: (percentage, agent) =>
      selectOptionAction(
        action,
        optionAtPercent(
          agent.get(HomeAssistantEntityBehavior).entity.state,
          percentage,
        ),
      ),
    setAutoMode: (_, agent) => currentStageAction(action, agent),
    setAirflowDirection: (_, agent) => currentStageAction(action, agent),
    setPresetMode: (presetMode) => selectOptionAction(action, presetMode),
    setOscillation: (_, agent) => currentStageAction(action, agent),
    setWindMode: (_, agent) => currentStageAction(action, agent),
  }).with("Step", "MultiSpeed");
}

function selectStageProfile(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
  action: SelectAction,
): EndpointType | undefined {
  const profile = homeAssistantEntity.mapping?.matterDeviceType;
  if (profile === "speaker") {
    return SpeakerDevice.with(
      BasicInformationServer,
      IdentifyServer,
      HomeAssistantEntityBehavior,
      buildStageOnOffServer(action),
      buildSelectSpeakerLevelServer(action),
    ).set({ homeAssistantEntity });
  }
  if (profile === "basic_video_player") {
    return BasicVideoPlayerDevice.with(
      BasicInformationServer,
      IdentifyServer,
      HomeAssistantEntityBehavior,
      MediaPlayerMediaPlaybackServer,
      MediaPlayerKeypadInputServer,
      buildSelectMediaInputServer(action),
    ).set({ homeAssistantEntity });
  }
  if (profile === "fan") {
    return MatterFanDevice.with(
      BasicInformationServer,
      IdentifyServer,
      HomeAssistantEntityBehavior,
      GroupsServer,
      buildStageOnOffServer(action),
      buildSelectFanControlServer(action),
    ).set({ homeAssistantEntity });
  }
  return undefined;
}

// Controllers can't render ModeSelect (#356), so a select can opt into a
// plain switch instead: "on" and "off" each select a configured option.
function buildSelectOnOffServer(action: string) {
  const option = (agent: Agent, key: "on" | "off") => {
    const mapping = agent.get(HomeAssistantEntityBehavior).state.mapping;
    return key === "on"
      ? mapping?.selectSwitchOnOption
      : mapping?.selectSwitchOffOption;
  };
  return OnOffServer({
    // Case-insensitive like the ModeSelect path, some integrations
    // report options with different casing.
    isOn: (state, agent) =>
      state.state?.toLowerCase() === option(agent, "on")?.toLowerCase(),
    turnOn: (_, agent) => ({
      action,
      data: { option: option(agent, "on") },
    }),
    turnOff: (_, agent) => ({
      action,
      data: { option: option(agent, "off") },
    }),
  });
}

const SelectPlugSwitchType = OnOffPlugInUnitDevice.with(
  BasicInformationServer,
  IdentifyServer,
  HomeAssistantEntityBehavior,
  GroupsServer,
  ScenesManagementServer,
  buildSelectOnOffServer("select.select_option"),
);
const SelectLightSwitchType = OnOffLightDevice.with(
  BasicInformationServer,
  IdentifyServer,
  HomeAssistantEntityBehavior,
  GroupsServer,
  ScenesManagementServer,
  buildSelectOnOffServer("select.select_option"),
);
const InputSelectPlugSwitchType = OnOffPlugInUnitDevice.with(
  BasicInformationServer,
  IdentifyServer,
  HomeAssistantEntityBehavior,
  GroupsServer,
  ScenesManagementServer,
  buildSelectOnOffServer("input_select.select_option"),
);
const InputSelectLightSwitchType = OnOffLightDevice.with(
  BasicInformationServer,
  IdentifyServer,
  HomeAssistantEntityBehavior,
  GroupsServer,
  ScenesManagementServer,
  buildSelectOnOffServer("input_select.select_option"),
);

function selectAsSwitch(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
  plugType: typeof SelectPlugSwitchType,
  lightType: typeof SelectLightSwitchType,
): EndpointType | undefined {
  const mapping = homeAssistantEntity.mapping;
  if (
    mapping?.selectExposeAsSwitch !== true ||
    !mapping.selectSwitchOnOption ||
    !mapping.selectSwitchOffOption
  ) {
    return undefined;
  }
  const type =
    mapping.matterDeviceType === "on_off_light" ||
    mapping.matterDeviceType === "on_off_switch"
      ? lightType
      : plugType;
  return type.set({ homeAssistantEntity });
}

const SelectEndpointType = ModeSelectDevice.with(
  BasicInformationServer,
  IdentifyServer,
  HomeAssistantEntityBehavior,
  SelectModeServer,
);

const InputSelectEndpointType = ModeSelectDevice.with(
  BasicInformationServer,
  IdentifyServer,
  HomeAssistantEntityBehavior,
  InputSelectModeServer,
);

export function SelectDevice(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType | undefined {
  const asSwitch = selectAsSwitch(
    homeAssistantEntity,
    SelectPlugSwitchType,
    SelectLightSwitchType,
  );
  if (asSwitch) {
    return asSwitch;
  }
  const stageProfile = selectStageProfile(
    homeAssistantEntity,
    "select.select_option",
  );
  if (stageProfile) {
    return stageProfile;
  }
  const attrs = homeAssistantEntity.entity.state.attributes as SelectAttributes;
  const options = attrs.options ?? [];

  if (options.length === 0) {
    return undefined;
  }

  const currentOption = homeAssistantEntity.entity.state.state;
  const currentIndex = currentOption
    ? options.findIndex((o) => o.toLowerCase() === currentOption.toLowerCase())
    : 0;

  const labels = homeAssistantEntity.mapping?.modeSelectOptions;
  const displayOptions = labels?.length === options.length ? labels : options;

  return SelectEndpointType.set({
    homeAssistantEntity,
    modeSelect: {
      description:
        homeAssistantEntity.customName ??
        (
          homeAssistantEntity.entity.state.attributes as {
            friendly_name?: string;
          }
        ).friendly_name ??
        "Select",
      supportedModes: buildSupportedModes(displayOptions),
      currentMode: currentIndex >= 0 ? currentIndex : 0,
    },
  });
}

export function InputSelectDevice(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
): EndpointType | undefined {
  const asSwitch = selectAsSwitch(
    homeAssistantEntity,
    InputSelectPlugSwitchType,
    InputSelectLightSwitchType,
  );
  if (asSwitch) {
    return asSwitch;
  }
  const stageProfile = selectStageProfile(
    homeAssistantEntity,
    "input_select.select_option",
  );
  if (stageProfile) {
    return stageProfile;
  }
  const attrs = homeAssistantEntity.entity.state.attributes as SelectAttributes;
  const options = attrs.options ?? [];

  if (options.length === 0) {
    return undefined;
  }

  const currentOption = homeAssistantEntity.entity.state.state;
  const currentIndex = currentOption
    ? options.findIndex((o) => o.toLowerCase() === currentOption.toLowerCase())
    : 0;

  const labels = homeAssistantEntity.mapping?.modeSelectOptions;
  const displayOptions = labels?.length === options.length ? labels : options;

  return InputSelectEndpointType.set({
    homeAssistantEntity,
    modeSelect: {
      description:
        homeAssistantEntity.customName ??
        (
          homeAssistantEntity.entity.state.attributes as {
            friendly_name?: string;
          }
        ).friendly_name ??
        "Input Select",
      supportedModes: buildSupportedModes(displayOptions),
      currentMode: currentIndex >= 0 ? currentIndex : 0,
    },
  });
}
