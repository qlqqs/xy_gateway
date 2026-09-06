interface PostHogClient {
    opt_in_capturing: () => void;
    opt_out_capturing: () => void;
}

declare global {
    interface Window {
        posthog?: PostHogClient;
    }
}

export {};
