# Third-party notices

Somnoscribe is licensed under AGPL-3.0-only. Its dependencies remain subject to their own licenses and copyright notices, and are not covered by any commercial licence granted for Somnoscribe itself. The lockfiles are the authoritative version inventory; distributions should preserve dependency license files.

Primary JavaScript runtime dependencies include:

| Component                 | License      |
| ------------------------- | ------------ |
| better-sqlite3            | MIT          |
| cors                      | MIT          |
| dotenv                    | BSD-2-Clause |
| Express                   | MIT          |
| express-rate-limit        | MIT          |
| Helmet                    | MIT          |
| Multer                    | MIT          |
| OpenAI JavaScript library | Apache-2.0   |
| Pino                      | MIT          |
| React and React DOM       | MIT          |
| Lucide React              | ISC          |
| Inter variable font       | OFL-1.1      |
| Zod                       | MIT          |

Primary Python runtime dependencies include:

| Component        | License            |
| ---------------- | ------------------ |
| FastAPI          | MIT                |
| Starlette        | BSD-3-Clause       |
| Uvicorn          | BSD-3-Clause       |
| python-multipart | Apache-2.0         |
| pyEDFlib         | BSD-2-Clause       |
| NumPy            | BSD-3-Clause       |
| Pillow           | MIT-CMU            |
| Pydantic         | MIT                |
| Matplotlib       | Matplotlib license |
| pypdf            | BSD-3-Clause       |

Development tooling includes Playwright (Apache-2.0), TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), Tailwind CSS (MIT), pytest (MIT), HTTPX (BSD-3-Clause), Ruff (MIT), and MNE-Python (BSD-3-Clause), which is a test-only cross-check and is not installed in the runtime image. Transitive build data and tooling include caniuse-lite (CC-BY-4.0) and Lightning CSS (MPL-2.0).

Installed binary wheels can contain separately licensed runtime libraries, so container and binary distributors must review the artifacts they actually ship, not only this source inventory.

No vendor software, manual, clinical standard, external dataset, or reference pack is redistributed here. The SOMNOtouch and DOMINO compatibility names and the no-endorsement statement are in [NOTICE](NOTICE).
