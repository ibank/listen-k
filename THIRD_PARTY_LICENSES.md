# Third-Party Licenses

Listen K bundles or links to the following open-source components. Each
component is distributed under its own license, reproduced below or linked to
its authoritative source. License compatibility with the project's MIT license
was last verified on 2026-04-22.

---

## Runtime (bundled or dynamically loaded)

### Electron — MIT

Copyright (c) Electron contributors
Copyright (c) 2013-present GitHub Inc.

https://github.com/electron/electron/blob/main/LICENSE

### WhisperKit — MIT

Copyright (c) 2024 Argmax, Inc.

https://github.com/argmaxinc/WhisperKit/blob/main/LICENSE

### mlx-swift — MIT

Copyright © 2023-2024 Apple Inc.

https://github.com/ml-explore/mlx-swift/blob/main/LICENSE

### mlx-swift-examples — MIT

Copyright © 2024 Apple Inc.

https://github.com/ml-explore/mlx-swift-examples/blob/main/LICENSE

### whisper.cpp / ggml — MIT

Copyright (c) 2023-2024 The ggml authors

https://github.com/ggerganov/whisper.cpp/blob/master/LICENSE

### swift-argument-parser — Apache License 2.0

Copyright 2020 Apple Inc. and the Swift project authors

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License. You may obtain a copy of
the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.

Full license and NOTICE: https://github.com/apple/swift-argument-parser/blob/main/LICENSE.txt

---

## External processes (not bundled)

### Ollama — MIT

Listen K optionally invokes `ollama` as an external HTTP service at
`http://localhost:11434`. Ollama is not distributed with Listen K.

https://github.com/ollama/ollama/blob/main/LICENSE

### OpenAI API

When the user configures an OpenAI API key, Listen K sends audio or text to
OpenAI's servers. Usage is subject to [OpenAI's Terms of
Service](https://openai.com/policies/terms-of-use) and is the user's
responsibility.

---

## Models (downloaded at install time, not included in the source)

### Whisper (openai/whisper) — MIT

OpenAI Whisper weights and tokenizer are distributed under MIT via the
[openai/whisper](https://github.com/openai/whisper/blob/main/LICENSE) and
[argmaxinc on Hugging Face](https://huggingface.co/argmaxinc) repositories.
Listen K downloads them at setup time via `scripts/download-whisperkit-model.sh`.

### ggml Whisper — MIT

Alternative engine; same license as whisper.cpp above.

### MLX language models (optional translate helper)

Models pulled for the optional translate helper are subject to their
respective Hugging Face page licenses. The helper defers license acceptance
to the user at pull time.

---

## Assets

The Listen K name, logo, and product icons are © 2026 ibank and are **not**
covered by the MIT license on the source code. See [README.md](README.md#trademark)
for trademark usage guidelines.

---

If a dependency appears to be missing from this file, please open an issue.
