import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { fetchChannelModels } from "@/services/api/image";
import { encodeChannelModel, guessCapability, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));

        // [CUSTOM] 2026-11-04 自动拉取渠道模型：导入渠道后立即请求 /models 并写入渠道，
        // 这样进入画布即可直接选用模型（参考站行为），无需手动点「编辑 → 刷新模型」。
        if (result.status === "created" || result.status === "updated") {
            void (async () => {
                const state = useConfigStore.getState();
                const target = state.config.channels.find(
                    (channel) => channel.baseUrl.replace(/\/+$/, "") === (baseUrl || "").trim().replace(/\/+$/, ""),
                );
                if (!target || target.models.length > 0) return;
                try {
                    const names = await fetchChannelModels(target);
                    if (!names.length) return;
                    const fresh = useConfigStore.getState().config;
                    const channels = fresh.channels.map((channel) =>
                        channel.id === target.id
                            ? { ...channel, models: names.map((name) => ({ name, capability: guessCapability(name) })) }
                            : channel,
                    );
                    useConfigStore.getState().updateConfig("channels", channels);
                    // [CUSTOM] 2026-11-04 自动把画布默认模型指向导入渠道的模型，
                    // 让用户进入画布即可直接开始创作（无需手动选模型）。
                    const byCapability = (capability: string) =>
                        names.find((name) => guessCapability(name) === capability);
                    const encode = (model: string) => encodeChannelModel(target.id, model);
                    const imageModel = byCapability("image");
                    const textModel = byCapability("text");
                    const videoModel = byCapability("video");
                    const audioModel = byCapability("audio");
                    const latest = useConfigStore.getState().config;
                    const next: typeof latest = { ...latest };
                    if (imageModel) next.imageModel = encode(imageModel);
                    if (textModel) next.textModel = encode(textModel);
                    if (videoModel) next.videoModel = encode(videoModel);
                    if (audioModel) next.audioModel = encode(audioModel);
                    const firstModel = imageModel || textModel || names[0];
                    if (firstModel) next.model = encode(firstModel);
                    useConfigStore.getState().updateConfig("imageModel", next.imageModel);
                    useConfigStore.getState().updateConfig("textModel", next.textModel);
                    useConfigStore.getState().updateConfig("videoModel", next.videoModel);
                    useConfigStore.getState().updateConfig("audioModel", next.audioModel);
                    if (firstModel) useConfigStore.getState().updateConfig("model", encode(firstModel));
                    message.success(t("config.importedChannelModels", { count: names.length }));
                } catch {
                    // 拉取失败保持原样，用户仍可手动刷新
                }
            })();
        }
    }, [importChannelCredentials, message, t]);

    return <>{children}</>;
}
