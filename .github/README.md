# Repository metadata

[labels.json](labels.json) records the canonical task labels configured on [the company repository](https://github.com/empiricinfotech/webhook-inbox/labels). It is a plain JSON array of name, six-digit hexadecimal color and description.

D01.2 added the five area labels (`api`, `web`, `worker`, `docs`, `tests`) and four release labels (`milestone:v0.1`, `milestone:v0.2`, `milestone:v0.3`, `milestone:v1.0`). The existing `bug` label is reused with its existing description/color. All other default labels are preserved.

Each of the four existing milestone issues has its corresponding release label. No issue title, body, state or acceptance checkbox was changed.

The manifest documents the live configuration; it does not run an automatic label-sync workflow. Maintainers should compare existing labels before applying a later change and preserve unrelated labels. See [CONTRIBUTING.md](../CONTRIBUTING.md) for usage.

CI workflows and issue/PR templates will be added at their planned tasks. No automation or application checks are configured by this directory yet.
