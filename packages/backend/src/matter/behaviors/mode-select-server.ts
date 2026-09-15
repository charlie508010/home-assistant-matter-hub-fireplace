import type { HomeAssistantEntityInformation } from "@home-assistant-matter-hub/common";
import { Logger } from "@matter/general";
import type { Agent } from "@matter/main";
import { ModeSelectServer as Base } from "@matter/main/behaviors";
import type { HomeAssistantAction } from "../../services/home-assistant/home-assistant-actions.js";
import { applyPatchState } from "../../utils/apply-patch-state.js";
import { HomeAssistantEntityBehavior } from "./home-assistant-entity-behavior.js";

const logger = Logger.get("ModeSelectServer");

export function modeSelectLogTag(
  entityId: string,
): "HEAT_MODE" | "FLAME_MODE" | "MODE_SELECT" {
  const normalized = entityId.toLowerCase();
  if (normalized.includes("heiz") || normalized.includes("heat")) {
    return "HEAT_MODE";
  }
  if (normalized.includes("flamm")) {
    return "FLAME_MODE";
  }
  return "MODE_SELECT";
}

export function buildSupportedModes(options: string[]) {
  return options.map((label, index) => ({
    label: label.length > 64 ? label.substring(0, 64) : label,
    mode: index,
    semanticTags: [],
  }));
}

export interface SelectModeConfig {
  getOptions: (
    entity: HomeAssistantEntityInformation,
    agent: Agent,
  ) => string[];
  getCurrentOption: (
    entity: HomeAssistantEntityInformation,
    agent: Agent,
  ) => string | undefined;
  /**
   * Optional controller-facing labels. The position must match getOptions();
   * getOptions() remains the HA value used for state matching and commands.
   */
  getLabels?: (
    entity: HomeAssistantEntityInformation,
    agent: Agent,
  ) => string[];
  selectOption: (option: string, agent: Agent) => HomeAssistantAction;
}

// biome-ignore lint/correctness/noUnusedVariables: Used by the factory function below
class ModeSelectServerBase extends Base {
  declare state: ModeSelectServerBase.State;

  override async initialize() {
    await super.initialize();
    const homeAssistant = await this.agent.load(HomeAssistantEntityBehavior);
    this.update(homeAssistant.entity);
    this.reactTo(homeAssistant.onChange, this.update, { lock: true });
  }

  private update(entity: HomeAssistantEntityInformation) {
    if (!entity.state || !entity.state.attributes) {
      return;
    }
    const config = this.state.config;
    const options = config.getOptions(entity, this.agent);
    const configuredLabels = config.getLabels?.(entity, this.agent);
    const labels =
      configuredLabels?.length === options.length ? configuredLabels : options;
    const current = config.getCurrentOption(entity, this.agent);

    if (options.length === 0) {
      return;
    }

    const currentIndex = current
      ? options.findIndex((o) => o.toLowerCase() === current.toLowerCase())
      : -1;

    applyPatchState(this.state, {
      supportedModes: buildSupportedModes(labels),
      currentMode: currentIndex >= 0 ? currentIndex : 0,
    });
  }

  override changeToMode(request: { newMode: number }) {
    const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
    const config = this.state.config;
    const options = config.getOptions(homeAssistant.entity, this.agent);
    const { newMode } = request;

    if (newMode < 0 || newMode >= options.length) {
      logger.warn(
        `[MATTER][${modeSelectLogTag(homeAssistant.entityId)}] Invalid ChangeToMode request: entity=${homeAssistant.entityId}, mode=${newMode}, options=[${options.join(", ")}]`,
      );
      return;
    }

    const option = options[newMode];
    logger.info(
      `[MATTER][${modeSelectLogTag(homeAssistant.entityId)}] ChangeToMode requested: entity=${homeAssistant.entityId}, mode=${newMode}, option="${option}"`,
    );

    applyPatchState(this.state, { currentMode: newMode });
    homeAssistant.callAction(config.selectOption(option, this.agent));
  }
}

namespace ModeSelectServerBase {
  export class State extends Base.State {
    config!: SelectModeConfig;
  }
}

export function ModeSelectServer(config: SelectModeConfig) {
  return ModeSelectServerBase.set({ config });
}
