import type { HomeAssistantEntityInformation } from "@home-assistant-matter-hub/common";
import { MediaInputServer as Base } from "@matter/main/behaviors";
import { MediaInput } from "@matter/main/clusters";
import { applyPatchState } from "../../utils/apply-patch-state.js";
import { HomeAssistantEntityBehavior } from "./home-assistant-entity-behavior.js";
import type { ValueGetter, ValueSetter } from "./utils/cluster-config.js";

export interface MediaInputServerConfig {
  getCurrentSource: ValueGetter<string | undefined>;
  getSourceList: ValueGetter<string[] | undefined>;
  /** Optional controller-facing labels in the same order as getSourceList(). */
  getSourceLabels?: ValueGetter<string[] | undefined>;

  selectSource: ValueSetter<string>;
}

// biome-ignore lint/correctness/noUnusedVariables: Biome thinks this is unused, but it's used by the function below
class MediaInputServerBase extends Base {
  declare state: MediaInputServerBase.State;

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
    const rawSources = config.getSourceList(entity.state, this.agent) ?? [];
    const configuredLabels = config.getSourceLabels?.(entity.state, this.agent);
    const labels =
      configuredLabels?.length === rawSources.length
        ? configuredLabels
        : rawSources;
    const sources = rawSources
      .map((source, index) => ({ source, label: labels[index] }))
      .sort((a, b) => a.source.localeCompare(b.source));
    const inputList = sources.map(({ label }, index) => ({
      index,
      inputType: MediaInput.InputType.Other,
      name: label,
      description: label,
    }));
    const currentSource = config.getCurrentSource(entity.state, this.agent);
    let currentInput = sources.findIndex(
      ({ source }) => source === currentSource,
    );
    if (currentInput === -1) {
      currentInput = 0;
    }
    applyPatchState(this.state, {
      inputList,
      currentInput,
    });
  }

  override selectInput(request: MediaInput.SelectInputRequest) {
    const homeAssistant = this.agent.get(HomeAssistantEntityBehavior);
    const sources = [
      ...(this.state.config.getSourceList(
        homeAssistant.entity.state,
        this.agent,
      ) ?? []),
    ].sort((a, b) => a.localeCompare(b));
    const target = sources[request.index];
    if (target == null) {
      return;
    }
    homeAssistant.callAction(
      this.state.config.selectSource(target, this.agent),
    );
  }

  override showInputStatus() {}

  override hideInputStatus() {}
}

namespace MediaInputServerBase {
  export class State extends Base.State {
    config!: MediaInputServerConfig;
  }
}

export function MediaInputServer(config: MediaInputServerConfig) {
  return MediaInputServerBase.set({ config });
}
