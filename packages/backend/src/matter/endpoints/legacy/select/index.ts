import type {
  HomeAssistantEntityInformation,
  HomeAssistantEntityState,
} from "@home-assistant-matter-hub/common";
import type { Agent, EndpointType } from "@matter/main";
import {
  DescriptorServer,
  GroupsServer,
  ScenesManagementServer,
} from "@matter/main/behaviors";
import { DishwasherModeServer as BaseDishwasherModeServer } from "@matter/main/behaviors/dishwasher-mode";
import { LaundryWasherModeServer as BaseLaundryWasherModeServer } from "@matter/main/behaviors/laundry-washer-mode";
import {
  DishwasherMode,
  FanControl,
  LaundryWasherMode,
  RvcOperationalState,
  RvcRunMode,
  WindowCovering,
} from "@matter/main/clusters";
import { ModeBase } from "@matter/main/clusters/mode-base";
import {
  AirPurifierDevice,
  BasicVideoPlayerDevice,
  FanDevice as MatterFanDevice,
  ModeSelectDevice,
  OnOffLightDevice,
  OnOffPlugInUnitDevice,
  RoboticVacuumCleanerDevice,
  SpeakerDevice,
  WindowCoveringDevice,
} from "@matter/main/devices";
import { DeviceTypeId } from "@matter/types";
import { applyPatchState } from "../../../../utils/apply-patch-state.js";
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
import { RvcOperationalStateServer } from "../../../behaviors/rvc-operational-state-server.js";
import {
  RvcRunModeServer,
  RvcSupportedRunMode,
} from "../../../behaviors/rvc-run-mode-server.js";
import { SpeakerLevelControlServer } from "../../../behaviors/speaker-level-control-server.js";
import { WindowCoveringServer } from "../../../behaviors/window-covering-server.js";
import {
  DishwasherEndpoint,
  LaundryWasherEndpoint,
} from "../dishwasher/index.js";
import { MediaPlayerKeypadInputServer } from "../media-player/behaviors/media-player-keypad-input-server.js";
import { MediaPlayerMediaPlaybackServer } from "../media-player/behaviors/media-player-media-playback-server.js";
import { createDefaultRvcCleanModeServer } from "../vacuum/behaviors/vacuum-rvc-clean-mode-server.js";

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

function includesOption(options: string[], value: string) {
  return options.some((option) => option.toLowerCase() === value.toLowerCase());
}

function getMatterOptions(state: HomeAssistantEntityState, agent?: Agent) {
  const options = getStateOptions(state);
  const mappedOptions = agent?.get(HomeAssistantEntityBehavior).state.mapping
    ?.modeSelectOptions;
  if (
    mappedOptions?.length &&
    mappedOptions.every((option) => includesOption(options, option))
  ) {
    return mappedOptions;
  }
  return options;
}

function getDisplayOptions(state: HomeAssistantEntityState, agent: Agent) {
  const options = getMatterOptions(state, agent);
  const labels = agent.get(HomeAssistantEntityBehavior).state.mapping
    ?.modeSelectOptions;
  if (
    labels?.length === options.length &&
    !labels.every((label) => includesOption(options, label))
  ) {
    return labels;
  }
  return options;
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
    getOptions: (entity, agent) => getMatterOptions(entity.state, agent),
    getLabels: (entity, agent) => getDisplayOptions(entity.state, agent),
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

const modeSelectDeviceType = {
  deviceType: DeviceTypeId(0x0027),
  revision: 1,
};

function buildSelectLampModeDevice(
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
  action: SelectAction,
) {
  const state = homeAssistantEntity.entity.state;
  const options = getStateOptions(state);
  const labels = homeAssistantEntity.mapping?.modeSelectOptions;
  const displayOptions = labels?.length === options.length ? labels : options;
  const current = options.findIndex(
    (option) => option.toLowerCase() === state.state?.toLowerCase(),
  );

  return OnOffLightDevice.with(
    BasicInformationServer,
    IdentifyServer,
    HomeAssistantEntityBehavior,
    GroupsServer,
    ScenesManagementServer,
    buildStageOnOffServer(action),
    DescriptorServer,
    buildSelectModeServer(action),
  ).set({
    homeAssistantEntity,
    descriptor: {
      deviceTypeList: [
        {
          deviceType: OnOffLightDevice.deviceType,
          revision: OnOffLightDevice.deviceRevision,
        },
        modeSelectDeviceType,
      ],
    },
    modeSelect: {
      description: homeAssistantEntity.customName ?? "Flammenfarbe",
      supportedModes: buildSupportedModes(displayOptions),
      currentMode: current >= 0 ? current : 0,
    },
  });
}

function dishwasherModes(
  state: HomeAssistantEntityState,
  agent: Agent,
  optionSubset?: string[],
  modeIdOffset = 0,
  displayLabels?: string[],
) {
  const labels =
    displayLabels ?? optionSubset ?? getDisplayOptions(state, agent);
  const tags = [
    DishwasherMode.ModeTag.Normal,
    DishwasherMode.ModeTag.Light,
    DishwasherMode.ModeTag.Quick,
    DishwasherMode.ModeTag.LowEnergy,
    DishwasherMode.ModeTag.Heavy,
    DishwasherMode.ModeTag.Max,
  ];
  return labels.map((label, index) => ({
    label,
    mode: index + modeIdOffset,
    modeTags: [{ value: tags[index] ?? DishwasherMode.ModeTag.Normal }],
  }));
}

export class SelectDishwasherModeServerBase extends BaseDishwasherModeServer {
  declare state: SelectDishwasherModeServerBase.State;

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
    const options = this.state.optionSubset ?? getSelectOptions(entity);
    if (options.length === 0) return;
    const currentMode = options.findIndex(
      (option) => option.toLowerCase() === entity.state.state?.toLowerCase(),
    );
    applyPatchState(this.state, {
      supportedModes: dishwasherModes(
        entity.state,
        this.agent,
        this.state.optionSubset,
        this.state.modeIdOffset,
        this.state.displayLabels,
      ),
      currentMode:
        (currentMode >= 0 ? currentMode : 0) + (this.state.modeIdOffset ?? 0),
    });
  }

  override async changeToMode(request: ModeBase.ChangeToModeRequest) {
    const modeIndex = this.state.supportedModes.findIndex(
      (mode) => mode.mode === request.newMode,
    );
    if (modeIndex < 0) {
      return {
        status: ModeBase.ModeChangeStatus.UnsupportedMode,
        statusText: "Unsupported stage",
      };
    }
    const result = await super.changeToMode(request);
    if (result.status === ModeBase.ModeChangeStatus.Success) {
      const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
      const option = (this.state.optionSubset ??
        getSelectOptions(homeAssistant.entity))[modeIndex];
      if (option !== undefined) {
        homeAssistant.callAction(selectOptionAction(this.state.action, option));
      }
    }
    return result;
  }
}

export namespace SelectDishwasherModeServerBase {
  export class State extends BaseDishwasherModeServer.State {
    action!: SelectAction;
    optionSubset?: string[];
    modeIdOffset?: number;
    displayLabels?: string[];
  }
}

export function buildSelectDishwasherModeServer(
  action: SelectAction,
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
  optionSubset?: string[],
  modeIdOffset = 0,
  displayLabels?: string[],
) {
  const state = homeAssistantEntity.entity.state;
  const options = optionSubset ?? getStateOptions(state);
  const currentMode = options.findIndex(
    (option) => option.toLowerCase() === state.state?.toLowerCase(),
  );
  const labels = homeAssistantEntity.mapping?.modeSelectOptions;
  const displayOptions =
    displayLabels ??
    optionSubset ??
    (labels?.length === options.length ? labels : options);
  return SelectDishwasherModeServerBase.set({
    action,
    optionSubset,
    modeIdOffset,
    displayLabels,
    supportedModes: displayOptions.map((label, index) => ({
      label,
      mode: index + modeIdOffset,
      modeTags: [
        {
          value:
            [
              DishwasherMode.ModeTag.Normal,
              DishwasherMode.ModeTag.Light,
              DishwasherMode.ModeTag.Quick,
              DishwasherMode.ModeTag.LowEnergy,
              DishwasherMode.ModeTag.Heavy,
              DishwasherMode.ModeTag.Max,
            ][index] ?? DishwasherMode.ModeTag.Normal,
        },
      ],
    })),
    currentMode: (currentMode >= 0 ? currentMode : 0) + modeIdOffset,
  });
}

function laundryWasherModes(state: HomeAssistantEntityState, agent: Agent) {
  const tags = [
    LaundryWasherMode.ModeTag.Normal,
    LaundryWasherMode.ModeTag.Quick,
    LaundryWasherMode.ModeTag.Delicate,
    LaundryWasherMode.ModeTag.LowEnergy,
    LaundryWasherMode.ModeTag.Heavy,
    LaundryWasherMode.ModeTag.Max,
  ];
  return getDisplayOptions(state, agent).map((label, mode) => ({
    label,
    mode,
    modeTags: [{ value: tags[mode] ?? LaundryWasherMode.ModeTag.Normal }],
  }));
}

// biome-ignore lint/correctness/noUnusedVariables: Used by the factory below
class SelectLaundryWasherModeServerBase extends BaseLaundryWasherModeServer {
  declare state: SelectLaundryWasherModeServerBase.State;

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
    const options = getSelectOptions(entity);
    if (options.length === 0) return;
    const currentMode = options.findIndex(
      (option) => option.toLowerCase() === entity.state.state?.toLowerCase(),
    );
    applyPatchState(this.state, {
      supportedModes: laundryWasherModes(entity.state, this.agent),
      currentMode: currentMode >= 0 ? currentMode : 0,
    });
  }

  override async changeToMode(request: ModeBase.ChangeToModeRequest) {
    const result = await super.changeToMode(request);
    if (result.status === ModeBase.ModeChangeStatus.Success) {
      const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
      const option = getSelectOptions(homeAssistant.entity)[request.newMode];
      if (option !== undefined) {
        homeAssistant.callAction(selectOptionAction(this.state.action, option));
      }
    }
    return result;
  }
}

namespace SelectLaundryWasherModeServerBase {
  export class State extends BaseLaundryWasherModeServer.State {
    action!: SelectAction;
  }
}

function buildSelectLaundryWasherModeServer(
  action: SelectAction,
  homeAssistantEntity: HomeAssistantEntityBehavior.State,
) {
  const state = homeAssistantEntity.entity.state;
  const options = getStateOptions(state);
  const currentMode = options.findIndex(
    (option) => option.toLowerCase() === state.state?.toLowerCase(),
  );
  const labels = homeAssistantEntity.mapping?.modeSelectOptions;
  const displayOptions = labels?.length === options.length ? labels : options;
  const tags = [
    LaundryWasherMode.ModeTag.Normal,
    LaundryWasherMode.ModeTag.Quick,
    LaundryWasherMode.ModeTag.Delicate,
    LaundryWasherMode.ModeTag.LowEnergy,
    LaundryWasherMode.ModeTag.Heavy,
    LaundryWasherMode.ModeTag.Max,
  ];
  return SelectLaundryWasherModeServerBase.set({
    action,
    supportedModes: displayOptions.map((label, mode) => ({
      label,
      mode,
      modeTags: [{ value: tags[mode] ?? LaundryWasherMode.ModeTag.Normal }],
    })),
    currentMode: currentMode >= 0 ? currentMode : 0,
  });
}

function buildSelectRvcRunModeServer(action: SelectAction) {
  const supportedModes = (state: HomeAssistantEntityState, agent: Agent) =>
    getDisplayOptions(state, agent).map((label, index) => ({
      label,
      mode: index <= 1 ? index : index + 99,
      modeTags: [
        {
          value:
            index === 0 ? RvcRunMode.ModeTag.Idle : RvcRunMode.ModeTag.Cleaning,
        },
      ],
    }));
  const currentMode = (state: HomeAssistantEntityState) => {
    const options = getStateOptions(state);
    const index = options.findIndex(
      (option) => option.toLowerCase() === state.state?.toLowerCase(),
    );
    return index < 0
      ? RvcSupportedRunMode.Idle
      : index <= 1
        ? index
        : index + 99;
  };
  return RvcRunModeServer(
    {
      getCurrentMode: currentMode,
      getSupportedModes: supportedModes,
      start: (_, agent) => {
        const options = getStateOptions(
          agent.get(HomeAssistantEntityBehavior).entity.state,
        );
        return selectOptionAction(action, options[1] ?? options[0] ?? "");
      },
      returnToBase: (_, agent) =>
        selectOptionAction(
          action,
          getStateOptions(
            agent.get(HomeAssistantEntityBehavior).entity.state,
          )[0] ?? "",
        ),
      pause: (_, agent) => currentStageAction(action, agent),
      cleanRoom: (mode, agent) =>
        selectOptionAction(
          action,
          getStateOptions(agent.get(HomeAssistantEntityBehavior).entity.state)[
            mode <= 1 ? mode : mode - 99
          ] ?? "",
        ),
    },
    {
      supportedModes: [
        {
          label: "Stufe 0",
          mode: 0,
          modeTags: [{ value: RvcRunMode.ModeTag.Idle }],
        },
        {
          label: "Stufe 1",
          mode: 1,
          modeTags: [{ value: RvcRunMode.ModeTag.Cleaning }],
        },
      ],
      currentMode: 0,
    },
  );
}

function buildSelectRvcOperationalStateServer(action: SelectAction) {
  return RvcOperationalStateServer({
    getOperationalState: (state) =>
      currentPercent(state) === 0
        ? RvcOperationalState.OperationalState.Stopped
        : RvcOperationalState.OperationalState.Running,
    pause: (_, agent) => currentStageAction(action, agent),
    resume: (_, agent) => currentStageAction(action, agent),
    goHome: (_, agent) =>
      selectOptionAction(
        action,
        getStateOptions(
          agent.get(HomeAssistantEntityBehavior).entity.state,
        )[0] ?? "",
      ),
  });
}

function buildSelectWindowCoveringServer(action: SelectAction) {
  return WindowCoveringServer({
    getCurrentLiftPosition: currentPercent,
    getCurrentTiltPosition: () => null,
    getMovementStatus: () => WindowCovering.MovementStatus.Stopped,
    stopCover: (_, agent) => currentStageAction(action, agent),
    openCoverLift: (_, agent) => {
      const options = getStateOptions(
        agent.get(HomeAssistantEntityBehavior).entity.state,
      );
      return selectOptionAction(action, options.at(-1) ?? "");
    },
    closeCoverLift: (_, agent) =>
      selectOptionAction(
        action,
        getStateOptions(
          agent.get(HomeAssistantEntityBehavior).entity.state,
        )[0] ?? "",
      ),
    setLiftPosition: (position, agent) =>
      selectOptionAction(
        action,
        optionAtPercent(
          agent.get(HomeAssistantEntityBehavior).entity.state,
          position,
        ),
      ),
    openCoverTilt: (_, agent) => currentStageAction(action, agent),
    closeCoverTilt: (_, agent) => currentStageAction(action, agent),
    setTiltPosition: (_, agent) => currentStageAction(action, agent),
  });
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
  if (profile === "air_purifier") {
    return AirPurifierDevice.with(
      BasicInformationServer,
      IdentifyServer,
      HomeAssistantEntityBehavior,
      buildStageOnOffServer(action),
      buildSelectFanControlServer(action),
    ).set({ homeAssistantEntity });
  }
  if (profile === "on_off_light") {
    return buildSelectLampModeDevice(homeAssistantEntity, action);
  }
  if (profile === "dishwasher") {
    const dishwasher = DishwasherEndpoint(
      homeAssistantEntity,
    ) as EndpointType & {
      with(...behaviors: unknown[]): EndpointType;
    };
    return dishwasher.with(
      buildSelectDishwasherModeServer(action, homeAssistantEntity),
    );
  }
  if (profile === "laundry_washer") {
    const washer = LaundryWasherEndpoint(
      homeAssistantEntity,
    ) as EndpointType & {
      with(...behaviors: unknown[]): EndpointType;
    };
    return washer.with(
      buildSelectLaundryWasherModeServer(action, homeAssistantEntity),
    );
  }
  if (profile === "robot_vacuum_cleaner") {
    return RoboticVacuumCleanerDevice.with(
      BasicInformationServer,
      IdentifyServer,
      HomeAssistantEntityBehavior,
      buildSelectRvcRunModeServer(action),
      buildSelectRvcOperationalStateServer(action),
      createDefaultRvcCleanModeServer(),
    ).set({ homeAssistantEntity });
  }
  if (profile === "window_covering") {
    return WindowCoveringDevice.with(
      BasicInformationServer,
      IdentifyServer,
      HomeAssistantEntityBehavior,
      buildSelectWindowCoveringServer(action),
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

  const mappedOptions = homeAssistantEntity.mapping?.modeSelectOptions;
  const exposedOptions =
    mappedOptions?.length &&
    mappedOptions.every((option) => includesOption(options, option))
      ? mappedOptions
      : options;
  const labels = homeAssistantEntity.mapping?.modeSelectOptions;
  const displayOptions =
    labels?.length === exposedOptions.length &&
    !labels.every((label) => includesOption(exposedOptions, label))
      ? labels
      : exposedOptions;
  const supportedModes = buildSupportedModes(displayOptions);

  const currentOption = homeAssistantEntity.entity.state.state;
  const currentIndex = currentOption
    ? exposedOptions.findIndex(
        (o) => o.toLowerCase() === currentOption.toLowerCase(),
      )
    : 0;

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
      supportedModes,
      currentMode:
        currentIndex >= 0
          ? (supportedModes[currentIndex]?.mode ?? currentIndex)
          : (supportedModes[0]?.mode ?? 0),
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

  const mappedOptions = homeAssistantEntity.mapping?.modeSelectOptions;
  const exposedOptions =
    mappedOptions?.length &&
    mappedOptions.every((option) => includesOption(options, option))
      ? mappedOptions
      : options;
  const labels = homeAssistantEntity.mapping?.modeSelectOptions;
  const displayOptions =
    labels?.length === exposedOptions.length &&
    !labels.every((label) => includesOption(exposedOptions, label))
      ? labels
      : exposedOptions;
  const supportedModes = buildSupportedModes(displayOptions);

  const currentOption = homeAssistantEntity.entity.state.state;
  const currentIndex = currentOption
    ? exposedOptions.findIndex(
        (o) => o.toLowerCase() === currentOption.toLowerCase(),
      )
    : 0;

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
      supportedModes,
      currentMode:
        currentIndex >= 0
          ? (supportedModes[currentIndex]?.mode ?? currentIndex)
          : (supportedModes[0]?.mode ?? 0),
    },
  });
}
