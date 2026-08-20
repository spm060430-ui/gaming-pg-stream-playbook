// The decision layer. Wraps the Anthropic SDK so each agent can ask Claude for
// a single, structured decision via forced tool use. The model must respond
// with exactly one tool call; we parse its `input` and hand that back as the
// proposed action. The risk engine — not this module — decides whether the
// action is allowed.
//
// In DRY mode (no API key, or --dry) we never import or call the SDK: each
// agent supplies a deterministic `stub` that returns a plausible action, so the
// whole system runs and is smoke-testable offline with nothing installed.

export class Decider {
  constructor({ model, dry }) {
    this.model = model;
    this.dry = dry;
    this.Anthropic = null;
    this.client = null;
  }

  // Lazily load the SDK the first time a real decision is needed.
  async ensureClient() {
    if (this.client) return;
    const mod = await import("@anthropic-ai/sdk");
    this.Anthropic = mod.default;
    this.client = new this.Anthropic(); // resolves ANTHROPIC_API_KEY / profile
  }

  // system: string. context: any JSON-serializable object. tools: Anthropic
  // tool defs (with input_schema). stub: (context) => { tool, input } for dry.
  async decide({ system, context, tools, stub }) {
    if (this.dry) {
      const { tool, input } = stub(context);
      return { toolName: tool, action: input, note: "dry-stub", ok: true };
    }

    try {
      await this.ensureClient();
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        system,
        tools,
        tool_choice: { type: "any" }, // force exactly one tool call
        messages: [
          {
            role: "user",
            content:
              "Here is the current state. Make exactly one decision by calling " +
              "one tool.\n\n```json\n" +
              JSON.stringify(context, null, 2) +
              "\n```",
          },
        ],
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse) {
        return { ok: false, error: "Model did not return a tool call." };
      }
      return { toolName: toolUse.name, action: toolUse.input, ok: true };
    } catch (err) {
      // Per the prompt pack: on an API error, do not retry blindly — surface it
      // so the caller (and the Commander) can halt this desk for the cycle.
      return { ok: false, error: this.describeError(err) };
    }
  }

  describeError(err) {
    const A = this.Anthropic;
    if (A) {
      if (err instanceof A.AuthenticationError) return "auth error: check ANTHROPIC_API_KEY";
      if (err instanceof A.RateLimitError) return "rate limited";
      if (err instanceof A.APIError) return `API error ${err.status}: ${err.message}`;
    }
    return `unexpected error: ${err?.message || err}`;
  }
}
