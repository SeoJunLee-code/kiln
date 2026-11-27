# Kiln 인수인계

갱신: 2026-11-27 (20차: C의 (6) UI — `button`·`pin`, 입력 줄 `TICK NAME tap`. 같은 세션에서 (7)의 첫 측정만 했다: 틱당 할당 5~11KB, `bench/alloc.ts`, 아래 "다음 일"의 (7). 그 앞에 19차: C의 (5) 오디오 `sound`와 부품 `web/audio.ts`. 그 앞에 18차: C의 (4) 게임패드. 그 앞에 17차: C의 넷째 덩어리 — 레벨 간 상태 `tally`·`keep`. 그 앞에 16차: C의 둘째·셋째 덩어리 — `build`가 엔진 파일을 줄여 싣는다(`src/squeeze.ts`, 2D Lite 93,775 → 61,108바이트, 예산을 72,000으로 조였다), 스프라이트 애니메이션 `anim`. 그 앞에 15차: C의 첫 행 — 타일 문자별 색·이미지 `tiles paint=`, `#` 값 처리와 경고 K317~K319. 그 앞에 14차: 같은 명세를 Godot+에이전트로 만들고 Kiln으로 다시 실행해 비용을 비교했다 — `proof/lite/COMPARE.md`. 그 앞에 13차: Lite 증명 게임의 프레임 속도를 이 PC에서 규칙대로 쟀다 — `bench/frames.ts`, `proof/lite/FPS.md`. 그 앞에 12차: 헤드리스에서 장면이 `load`에서 끝나고 `--follow`로 다음 장면까지 간다. 입력 파일의 `expect`로 한 장면을 여러 번 검사한다. 그 앞에 11차: `solve`가 벽을 돌아가는 경로 거리를 쓰고 `count NAME == 0`을 지킨다. 그 앞에 10차: 실제 에이전트가 Lite 증명 게임을 끝까지 만들었고 비용을 기록했다. 그 앞에 9차: 에디션 선을 코드에 그었다 — `check`의 축별 에디션 판정, `--edition` 상한, `build`의 부품 선별과 바이트 예산. 그 앞에 8차 강체 규모 측정)

## 목표

AI 에이전트가 1급 사용자인 오픈소스 게임 엔진. 방향은 **"AI 우선, 사람이 감독"** 이다. 목표 수준은 Godot 동급을 거쳐 언리얼급이고, 사용자는 목표를 줄여 잡지 말라고 했다("자꾸 포기하지마").

- **에디션 3개로 낸다(사용자 결정, 2026-11-26): Lite(경량) · Standard(범용) · Ultra(하이엔드).** 엔진을 세 개 만드는 것이 아니라 공통 코어 하나 위에서 게임이 쓰는 만큼만 싣는다. 이유는 용량과 하드웨어 요구량이다. AI 도구(`check`·`solve`·`look`·`guide`·MCP)와 결정론은 세 에디션이 똑같고, 차이는 그래픽·물리·규모뿐이다. **에디션은 경쟁 엔진이 아니라 "어떤 기계에서 돌아야 하나"로 정의한다**(사용자 승인): Lite는 WebGPU 없는 기계, Standard는 내장 GPU+WebGPU에서 60fps, Ultra는 외장 GPU. 엔진 비교는 점수판의 행마다 그 기능을 제일 잘하는 엔진(Godot·Unity·Unreal)을 기준으로 한다. 전문은 `docs/EDITIONS.md`.
- 기능 목록과 판정 기준은 `docs/PARITY.md` 점수판이 전부다. 일은 점수판의 행을 오른쪽으로 옮기는 것이다.
- 성능 비교 규칙은 `bench/PROTOCOL.md`다. 사용자가 정했다: 기준 PC에서만 실제 비교, 추가 하드웨어는 일반화 검증, 동일 장면·동일 설정 필수, 평균 FPS와 1% Low와 GPU 프레임 시간 기록.
- 사용자의 원칙: **기능을 많이 넣는 것보다 넣은 기능이 퇴행하지 않게 지키는 것이 중요하다.** CI 검사가 막아 주지 않는 기능은 점수판에서 세지 않는다.

## 확정된 결정

- 스택: TypeScript, Node 24의 타입 제거 실행(빌드 단계 없음). 그래서 `enum`, 생성자 매개변수 속성은 못 쓰고 import에 `.ts` 확장자를 붙인다.
- 이름(2026-11-26, 사용자가 나에게 맡겨 정했다): 에디션은 **Lite · Standard · Ultra**, 코드 식별자는 `'lite' | 'standard' | 'ultra'`. 같은 날 첫 안은 Lite·Core·Pro와 "커널"이었는데, Core가 공통 바탕과 헷갈리고 Pro가 유료처럼 읽혀 바꿨다. 공통 바탕은 예전대로 **코어**라 부른다("커널"은 쓰지 않는다). **코드에 `'core'`·`'pro'`로 적은 에디션 식별자가 있으면 `'standard'`·`'ultra'`로 바꾼다.**
- 에디션 규칙 요약(전문은 `docs/EDITIONS.md`): 위 에디션은 아래 에디션을 포함한다 / 같은 입력은 어느 에디션에서나 같은 해시 / 에디션은 선언하지 않고 `check`가 **축별로**(그리기·물리·월드·네트워크) 계산해 알려 주고 게임의 에디션은 그중 가장 높은 것이다(상한은 `--edition`) / 게임은 쓰는 부품만 싣는다 / Lite 기능은 두 렌더러가 다 그리고 Standard·Ultra 기능은 WebGPU 전용 / 세 에디션 모두 같은 라이선스로 공개.
- 에디션 게이트는 네 가지가 다 있어야 닫힌다(사용자 승인, 2026-11-26): 점수판 행 / 예산(내보내기 바이트, 메모리, 첫 화면까지 시간, 틱당 할당 0) / **증명 게임**(에이전트가 명세로 만든 게임 하나가 그 에디션 기준 기계에서 60fps) / **에이전트 비용**(토큰, 시간, 사람 없이 고친 실패 수. 그래픽 수치보다 먼저 보고한다). Lite 증명 게임은 Gem Vault로 내가 정했다(10차, 사용자 확인 없음). Standard·Ultra 증명 게임과 Ultra 기준 기계는 아직 정하지 않았다.
- 의존성: **코어는 0. 선택형 백엔드(물리 등)는 버전을 고정해 포함할 수 있다**(사용자 승인, 2026-11-26). 의존성이 있는 곳은 `backends/rapier`(엔진이 쓰는 유일한 것, Rapier 0.21.0 고정)와 `spikes/physics`(사전 시험)다. 설치: `npm ci --prefix backends/rapier`.
- 시뮬레이션은 Q16.16 고정소수점(`src/fx.ts`)만 쓴다. float 연산을 시뮬레이션 경로에 넣지 않는다.
- 초당 값을 틱으로 나눌 때는 `tickShare`를 쓴다(단순 나눗셈은 누적 오차가 있었다).
- 렌더러: **WebGPU가 주 렌더러**, WebGL2는 지금 상태로 동결한 폴백. 새 기능은 WebGPU에만 넣는다.
- 물리: 3D 강체 솔버는 직접 만들지 않는다. Rapier 결정론 WASM 빌드를 백엔드 인터페이스 뒤에 붙인다. 격자·타일 게임용 고정소수점 상자 코어는 유지한다.
- 검사 세 종류: 상태는 해시로 세 OS에서 정확히 비교, 이미지는 기준 환경 한 곳(Linux CI, 소프트웨어 렌더링)에서만 허용 오차로 비교, 속도는 CI에서 흔들리지 않는 수치만 검사하고 실제 시간은 기준 PC에서만 잰다.
- 공개 저장소다. 커밋에 개인 정보, 절대경로, 키를 넣지 않는다. 커밋 작성자는 GitHub noreply 주소다.

## 작업 규칙

- 덩어리마다 `npm test`, `node scripts/hashes.ts --check`, `node scripts/images.ts`를 돌리고, 커밋·push한 뒤 CI 세 개(`ci`, `images`, `demo`)가 초록인지 본다.
- 기준 이미지를 바꿔야 하면 `images` 워크플로의 아티팩트(`gh run download <id> -n images`)를 받아 `tests/images/`에 넣는다. 이 PC에서 만든 이미지를 기준으로 쓰지 않는다.
- 사용자 지시(2026-11-26): 멈추지 말고 진행하고, 5시간 한도 98%에서만 멈춘다. 95% 근처에서는 새 덩어리를 시작하지 않는다. `mcp__ccd_session_mgmt__get_usage`로 확인한다.
- 여러 줄 코드를 셸 heredoc 안의 파이썬으로 고치면 `\n` 이스케이프가 깨진다. 파일은 Write/Edit 도구로 쓴다.

## 현재 상태

| 파일 | 역할 |
|---|---|
| `src/fx.ts` | 고정소수점 연산, 텍스트 왕복, 정수 sin/cos(`sinCos`, 2^24 배율 표), `isqrt` |
| `src/world.ts` | ECS, 컴포넌트 레지스트리 26종(`rigid`, `anim`, `tally`, `keep`, `sound`, `button`, `pin` 포함). `world.physics`(백엔드 이름)와 `world.link`(실행 중 백엔드 쪽 상태, 저장 안 됨). `pos`·`vel`·`box`는 선택적 z/d 값을 갖는다. `rot`(한 축 각도+spin), `quat`(사원수+축별 각속도)는 상태이고 해시에 들어간다 |
| `src/scene.ts` | 씬 파서·직렬화(`state` 줄, `prefab` 블록, 타일 `spawn` 전개), 진단 |
| `src/sim.ts` | 틱 진행(입력→ctrl→스크립트 pre→중력→이동·스윕 충돌→물리→회전→트리거→스크립트 post), 상태 해시. x·y·z 3축 |
| **`src/physics.ts`** | 물리 백엔드 인터페이스(`Backend`, `BackendWorld`)와 동기화 계층: 엔티티↔강체 대응, 고정소수점 경계 변환, `loadBackend`, 상태 저장·복원(`saveLink`/`restoreLink`/`freeLink`). 틱마다 `physicsSync`(이동 전, 강체 등록)→`physicsSweep`(이동 중, 강체 앞에서 멈추고 밀기)→`physicsStep`(이동 뒤, 백엔드 1스텝) 순서로 불린다. 시뮬레이션에서 float가 나오는 유일한 파일 |
| **`backends/rapier/`** | Rapier 어댑터(`index.ts`)와 고정된 의존성. 코어는 동적으로만 읽는다 |
| `src/expect.ts` | `expect` 5종 평가, 실패 시 관측값 설명 |
| `src/run.ts` | 헤드리스 실행, ASCII 뷰, 엔티티 덤프 |
| `src/solve.ts` | `solve`: expect를 만족하는 입력 탐색. 답은 재생으로 검증한 뒤 보고. 물리 장면은 스냅샷을 바이트 예산 캐시(기본 256MB)에 두고, 밀려난 노드는 조상에서 입력 경로를 다시 시뮬레이션해 되살린다 |
| `src/guide.ts` | `guide`: 에이전트가 한 번에 읽는 설명서(6,000자 예산을 테스트가 지킨다) |
| `src/lint.ts` | `check`의 경고(K300, K310~K314) |
| **`src/edition.ts`** | 에디션 판정: `needs`(Lite를 넘는 사용 목록, 줄 번호 포함), `axes`, `lowest`, `over`(상한 초과 → K140), `why`(축별 설명 줄). 줄 번호는 `parseScene`이 돌려주는 `Scene.at`에서 온다 |
| **`tests/edition.test.ts`** | 에디션 테스트 10개: 예제별 에디션 고정, 축, 상한, 프리팹, 폴더, WebGPU 전용 장면과의 일치, 빌드 부품과 바이트 예산 |
| `src/load.ts` | `use` 스크립트 로드, 비결정 API 검사(K121) |
| `src/api.ts` | 스크립트 API. 브라우저에서도 돈다 |
| `src/commands.ts`, `src/cli.ts`, `src/mcp.ts` | 명령 실행부, CLI, stdio MCP 서버(도구 `kiln` 하나) |
| **`src/squeeze.ts`** | `build`가 엔진 파일에서 주석·들여쓰기·빈 줄·연속 공백을 지운다. 문자열·템플릿·정규식 안은 그대로 두고 이름은 줄이지 않는다 |
| `src/serve.ts`, `src/build.ts`, `src/new.ts` | `play`용 서버, 정적 웹 내보내기, 게임 폴더 생성 |
| **`src/chrome.ts`** | 설치된 Chrome·Edge를 DevTools 프로토콜로 모는 드라이버. 의존성 없음(Node 내장 WebSocket). `KILN_CHROME`으로 실행 파일 지정 |
| **`src/look.ts`** | `look` 명령: 헤드리스 브라우저의 실제 플레이어로 장면을 그려 PNG와 짧은 설명을 돌려준다. MCP에서는 그림이 응답에 담긴다. `openPlayer`는 테스트가 쓴다 |
| **`src/png.ts`** | PNG 읽기·쓰기, 그림 요약(`summarize`), 허용 오차 비교(`compare`) |
| **`web/audio.ts`** | 샘플·음악 부품. 장면에 `sound`가 있을 때만 플레이어가 가져오고 `build`도 그때만 싣는다. `makeSounds(ctx, base, 구성요소)`는 `OfflineAudioContext`에서도 돈다(테스트가 그렇게 믹싱을 본다) |
| **`scripts/sounds.ts`** | 예제 소리 파일 생성기(`coin.wav`, `door.wav`, `tune.wav`: 삼각파, 8비트 모노 8kHz) |
| `web/player.ts` | 브라우저 플레이어. 게임패드(`pads`). `?paused`로 정지 시작, `?renderer=webgpu\|webgl2`, `?offscreen`, `window.kiln.shot()` |
| **`web/gpu.ts`** | WebGPU 렌더러(주). 물체마다 변환 행렬을 가진 인스턴스, 메시(머티리얼)당 그리기 호출 1회, 4x MSAA, 그림자 맵. 머티리얼 바인드 그룹: 상자·OBJ는 plain(예전 음영 식 그대로), glTF는 metallic-roughness(Cook-Torrance, 탄젠트 없는 노멀맵, 밉맵 텍스처). `read()`는 프레임을 텍스처에 다시 그려 복사해 온다 |
| `web/gl.ts` | WebGL2 렌더러(폴백, 동결). 회전과 glTF를 모른다(회전은 무시, glTF는 상자) |
| **`web/gltf.ts`** | glTF 2.0 리더(.glb, .gltf+.bin+이미지). 의존성 없음, Node에서도 돈다. 노드 변환을 정점에 굽고 단위 상자에 맞춘 뒤 머티리얼별 파트로 돌려준다. 못 읽는 것은 `warnings`에 적는다 |
| **`scripts/models.ts`** | 예제 glTF 모델 생성기(crate.glb, totem.gltf, orbs.glb). 출처 기록은 `examples/ASSETS.md` |
| **`tests/gltf.test.ts`** | glTF 리더 테스트 7개(브라우저 불필요) |
| **`tests/physics.test.ts`** | 물리 테스트 19개. 백엔드가 설치돼 있지 않으면 건너뛴다(CI는 설치한다) |
| **`web/mesh.ts`** | 두 렌더러가 같이 쓰는 기하·행렬·OBJ 해석·`Renderer3` 인터페이스. `boxMatrix`가 상자 중심 기준 회전을 포함한 인스턴스 행렬을 만든다 |
| `scripts/hashes.ts` | 예제 해시를 `examples/HASHES`와 비교. 의도한 변경이면 `--write` |
| **`scripts/images.ts`** | 예제 15장면을 그려 `tests/images/`와 비교. `'own'` 표시 장면은 WebGPU 전용 기준(`NAME.webgpu.png`)을 쓴다. Linux CI에서만 강제, 다른 곳은 참고 출력 |
| **`tests/browser.test.ts`** | 브라우저 동작 검사 10개. Chrome이 없으면 건너뛴다 |
| **`docs/PARITY.md`**, **`bench/PROTOCOL.md`** | 점수판, 측정 규칙 |
| **`docs/EDITIONS.md`** | 에디션 계획(Lite·Standard·Ultra): 용어, 기계 기준 정의, 축, 규칙, 게이트 조건(예산·증명 게임·에이전트 비용), 현재 기능의 에디션 분류와 크기 실측, 기존 엔진 단점별 대응, 계획 안의 충돌, 작업 순서 |
| **`spikes/`** | 사전 시험과 결과(`RESULTS.md`). 엔진이 import하지 않는다 |
| **`proof/lite/`** | Lite 증명 게임: `SPEC.md`(엔진 이름이 없는 명세, Godot 비교에도 그대로 쓴다), `game/`(에이전트가 만든 그대로), `RUN.md`(실행 조건, 에이전트 비용, 실패 7건, 사후 검증, 한계) |
| **`proof/lite/COMPARE.md`**, `proof/lite/rerun/`, `proof/lite/godot/` | 같은 명세 세 실행의 비용 비교, Kiln 2차 결과물, Godot 결과물 |
| **`scripts/agentcost.ts`**, **`tests/agentcost.test.ts`** | 헤드리스 Claude Code의 stream-json 로그에서 토큰·시간·도구 호출·실패 횟수를 집계한다. 테스트 3개 |
| **`tests/solvepath.test.ts`**, **`tests/fixtures/vault.kiln`** | solve 테스트 5개와 첫 에이전트가 막혔던 레벨 |
| **`tests/contact.test.ts`** | 트리거가 같은 틱에 한쪽을 지운 접촉을 `reach`·`never`가 본다(3개) |
| **`tests/proof.test.ts`** | 증명 게임 테스트 6개: 헤드리스 재생, Lite 검사, 빌드 바이트, 브라우저에서 레벨 전환·경비 재시작·닫힌 문 |
| `.github/workflows/` | `ci`(3 OS 테스트·해시), `images`(기준 이미지 비교), `pages`(데모 배포), `spikes`(사전 시험). 앞의 셋은 `backends/rapier`를 먼저 설치한다 |
| **`bench/frames.ts`**, **`proof/lite/FPS.md`**, `bench/raw/` | Lite 증명 게임 프레임 속도 측정 스크립트, 결과, 프레임별 원자료 |
| `bench/` | Godot 크기 비교(`size.ts`), 시뮬레이션 속도(`perf.ts`→`PERF.md`), **강체 규모(`physics.ts`→`PHYSICS.md`)**. 속도 벤치 둘은 `settle.ts`로 6초 부하를 준 뒤 지속 속도에서 잰다 |

## 검증 (2026-11-27 20차: UI)

C의 (6)이다. 문법·구성요소 이름·경고 번호·화면 단위는 **내가 정했다**(사용자 확인 없음). 점수판 "UI": gated(labels only) → gated(라벨, 버튼, 화면 고정 자리 아홉 곳).

- **`button EVENT [action=none] [key=]`**(새 주제 `ui`): 그 엔티티의 상자를 클릭·탭하면, 또는 `key`에 적은 액션(`a` 등)을 **새로 누른 틱**에, 이벤트를 내고 트리거와 같은 동작을 한다(`despawn-self`, `despawn:REF`, `load:FILE`, `+`로 이음). 이벤트의 a는 버튼 이름이다. 버튼의 `label`은 상자 **안에** 그려진다. 색을 안 주면 어두운 상자다.
- **누름은 입력이다**: 플레이어가 `TICK NAME tap`으로 기록하고(NAME은 버튼 엔티티 이름) 헤드리스가 그대로 재생한다. 입력 스크립트 안에서는 `['tap:NAME', true]`다. 이벤트는 트리거처럼 **다음 틱 번호**로 난다(틱 5의 탭 → 틱 6 이벤트). 버튼이 아닌 것을 탭하는 입력은 오류 **K201**이다(`run`이 시작할 때 본다. 틱 0에 없는 버튼을 스크립트가 나중에 만드는 경우는 오류로 잘못 잡힌다).
- **`pin WHERE [dx=0] [dy=0]`**: 월드가 아니라 화면에 그린다. WHERE는 `top-left top top-right left center right bottom-left bottom bottom-right`. `pos`가 필요 없고 카메라가 움직여도 그대로다. **화면 단위 1 = 보이는 영역의 짧은 변의 1/12**(상자 크기와 dx·dy에 쓴다. 카메라·월드 크기와 무관해서 월드가 없는 타이틀 화면도 된다). 상자 없는 고정 라벨은 글자가 그 자리에 붙는다(왼쪽 자리는 왼쪽 정렬, 위는 위 기준). 고정된 것은 월드 위에 그려진다.
- **구조**: `src/sim.ts`의 `step`이 그 틱에 새로 눌린 것(`fresh`)을 모으고, 트리거 직전에 버튼을 id 순서로 본다. 트리거의 동작 코드는 `act()`로 묶어 같이 쓴다. `web/player.ts`의 `rect(id)`가 엔티티의 화면 사각형을 계산하고(고정이면 화면 단위, 아니면 월드 배율) 그리기와 클릭 판정이 같이 쓴다. 클릭은 캔버스 `pointerdown`.
- **경고**: K328(`key`가 입력 액션이 아님), K329(`where`가 아홉 자리가 아님), K330(`pin`과 `pos`를 같이 씀: 그림은 pin, 충돌·트리거는 pos), K331(3D 장면의 button·pin은 안 그려짐). 버튼의 없는 `despawn:` 대상은 K311, 없는 `load:` 파일은 K312, 상자·자리 없음은 K310. K310은 `pin`이 있으면 `pos` 없음을 탓하지 않고, K314("ctrl 없음")는 버튼이 있으면 안 뜬다. K326(소리)은 버튼 이벤트도 "나는 이벤트"로 센다. **다음 경고 번호는 K332부터.**
- **예제**: `examples/title.kiln`(+`title.input`: `10 start tap`). 월드 없이 고정된 것만 있는 타이틀 화면이고 버튼(또는 Z)이 `level1`을 연다. `test title.kiln --follow`가 title → level1 → level2까지 간다. `HASHES`에 한 줄 추가, 기준 이미지 `tests/images/title@0.png`(Linux CI가 그린 것).
- **테스트 2개 추가(166개)**: `tests/m1.test.ts`(탭·키·누를 때마다 셈·동작·같은 해시·K201·경고 일곱 가지·예제 follow), `tests/browser.test.ts`(넓은 화면 960×600과 세로 화면 420×800에서: 고정 상자 셋이 규칙대로의 자리에 있고 카메라가 움직인 뒤에도 그대로, 버튼 옆 클릭은 무시, 고정 버튼과 월드 버튼 클릭이 기록되고 헤드리스 재생과 같은 해시, 동작으로 상자가 사라짐. 타이틀 예제는 라벨이 버튼 안에 있고 Z로 시작).
- **코어 가이드**: 주제 줄(`ui: button pin -- buttons, screen layout`)과 INPUT 줄의 `(ui: TICK NAME tap)`이 들어가 EXPECT·COMMANDS 절의 정렬 공백과 문구 둘을 줄였다. CLI 기준 5,519자(테스트 기준 5,590자쯤, 한도 5,600). 설명은 `guide ui`.
- 2D Lite 엔진 바이트: 65,221 → **67,497 / 72,000**(UI는 부품으로 빼지 않았다. `rect`가 그리기 전체에 엮여 있어서다. 남은 4,503바이트가 모자라면 뺄 후보다).
- **한계**: 배치 도구가 없다 — 줄·칸·묶음이 없어 엔티티마다 자리를 직접 준다. 글자 줄바꿈·글자 폭에 맞춘 상자가 없다(긴 라벨은 상자 밖으로 나간다). 마우스를 올리거나 누른 표시가 없다. 버튼 사이 포커스 이동이 없다(키·패드로는 `key`를 준 버튼만). 슬라이더·입력칸·스크롤·겹침 순서 지정이 없다(겹친 버튼은 둘 다 눌린다). 3D 장면에서는 안 그려진다(K331). `solve`는 탭하지 않는다(탭이 필요한 장면은 입력 파일을 직접 준다). 터치 패드(`#pad`)가 캔버스 아래쪽을 덮는 기기에서는 그 밑의 버튼을 누를 수 없다. 화면 단위가 짧은 변 기준이라 아주 좁은 화면에서는 글자가 최소 11px로 고정돼 상자보다 클 수 있다. 실제 휴대폰에서 눌러 본 적이 없다.
- `npm test` → 166개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 19차 커밋 `efa42b1`에서 `ci`(3 OS), `images`, `demo` 초록. 20차 커밋 `f10c6ec`에서 `images` 초록, `ci`·`demo`는 이 기록을 쓸 때 실행 중이었다(다음 세션이 `gh run list`로 확인한다. 기준 이미지 `title@0.png`는 임시 브랜치 `tmp-ui`로 받았고 브랜치는 지웠다).

## 검증 (2026-11-27 19차: 오디오)

C의 (5)다. 문법·구성요소 이름·경고 번호는 **내가 정했다**(사용자 확인 없음). 점수판 "Audio": gated(event tones only) → gated(이벤트별 샘플, 반복 음악 한 곡, 볼륨 둘).

- **`sound EVENT:FILE,... [music=FILE] [vol=1] [mvol=0.5]`**(새 주제 `audio`): 그 이벤트가 날 때마다 파일을 튼다(트리거의 이벤트, 스크립트의 `w.emit`, `load`). `music`은 반복한다. `vol`·`mvol`은 샘플과 음악의 크기(0..1). 파일은 장면 옆의 .wav/.mp3/.ogg. 장면에 `sound`가 있으면 **적은 이벤트만** 소리가 나고(이벤트마다 나던 임시 음은 꺼진다), 없으면 예전처럼 임시 음이 난다. 장면당 한 줄(첫 엔티티의 것만 쓴다).
- **부품**: `web/audio.ts`(빌드 후 1,224바이트)는 `sound`가 있는 장면에서만 플레이어가 `import()`하고, `build`는 폴더의 장면에 `sound` 줄이 있거나 스크립트가 `'sound'`를 적었을 때만 싣는다(`PARTS`의 `audio`). 소리 없는 2D Lite 게임은 그대로 `player.js`뿐이다.
- **언제 시작하나**: 브라우저는 키·탭 전에 소리를 허락하지 않는다. 첫 키·터치·패드 버튼에서 `wake()`가 `AudioContext`를 만들고 부품을 불러 파일을 받아 디코드한 뒤 음악을 튼다. M은 전체를 끈다(임시 음과 샘플·음악 모두).
- **상태가 아니다**: 소리는 시뮬레이션이 읽지 않는다. 다만 `sound`도 구성요소라 장면 텍스트·해시에는 들어간다(줄을 넣으면 해시가 바뀐다. `HASHES`의 `level1`·`level2` 두 줄이 그래서 바뀌었다). 헤드리스 테스트가 `sound` 줄이 있을 때와 없을 때 이벤트가 같음을 본다.
- **경고**: K325(쌍이 `EVENT:FILE`이 아님, 또는 파일이 wav/mp3/ogg가 아님), K326(그 이벤트를 내는 트리거가 장면에 없음. `use` 스크립트가 있으면 의심하지 않는다), K327(`sound`가 둘째 엔티티에도 있음), 없는 파일은 이미지와 같은 K312. **다음 경고 번호는 K328부터.**
- **테스트 2개 추가(164개)**:
  - `tests/browser.test.ts`: `level1`을 재생해 키 전에는 아무것도 안 틀고, 키 뒤 음악이 시작하고, 틱 200까지 시작된 파일이 이벤트 순서와 맞는지(`tune, coin, coin, door`) 본다. **믹싱은 소리를 스피커 대신 버퍼로 그려서**(`OfflineAudioContext`, 3초) 구간별 최댓값으로 본다: 샘플이 제 크기로 나고 0.25초 뒤엔 조용함, `vol=0.5`면 절반, 음악이 한 바퀴(2초) 뒤에도 남, `mvol=0`·mute면 0, 없는 파일은 콘솔 오류 + 나머지는 재생. 소리 없는 장면은 부품을 요청하지 않는다.
  - `tests/m1.test.ts`: 경고 다섯 가지와 헤드리스 무영향.
  - `tests/edition.test.ts`: 소리 있는 게임은 `audio` 부품과 wav를 싣고, 부품은 1,500바이트 미만.
- **예제**: `level1`·`level2`에 `entity audio`(`coin.wav`, `door.wav`, `tune.wav`). 소리 파일은 `scripts/sounds.ts`가 산술로 만든다(외부 출처 없음, `examples/ASSETS.md`).
- **코어 가이드**: 주제 줄(`audio: sound -- samples on events, music`)이 들어가 SCENE·OUTPUT 절의 정렬 공백을 줄였다. CLI 기준 5,519자(테스트 기준 5,590자쯤, 한도 5,600). **여전히 여유가 10자쯤이다.** 설명은 `guide audio`.
- 2D Lite 엔진 바이트(소리 없는 게임): 64,551 → **65,221 / 72,000**(구성요소 정의와 `wake`가 늘었다). 소리 있는 게임은 66,445.
- **한계**: **사람이 들어 본 적이 없다**(버퍼의 최댓값만 봤다. 듣기 좋은지, 실제 기기에서 나는지, 지연이 얼마인지 모른다). 헤드리스 Chrome에서는 실제 `AudioContext`가 멈춘 상태일 수 있어 플레이어 쪽 테스트는 "시작을 요청했다"까지만 본다. 장면이 바뀌면 페이지가 새로 열려 음악이 처음부터 다시 시작하고, 다음 키를 누를 때까지 조용하다(이어 틀기·크로스페이드 없음). 샘플별 볼륨·높낮이·위치(팬)·페이드·동시 재생 수 제한이 없다(같은 틱에 같은 이벤트가 여러 번 나면 겹쳐서 커진다). `runTo`로 빨리 감으면 그사이 이벤트의 샘플이 한꺼번에 난다. 재생(`--input`) 모드에서도 키를 눌러야 소리가 난다. 압축 포맷(mp3/ogg)은 브라우저 디코더에 맡기며 시험한 것은 wav뿐이다. K326은 프리팹 중 한 번도 찍히지 않은 것의 트리거는 보지 않는다.
- `npm test` → 164개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).

## 검증 (2026-11-27 18차: 게임패드)

C의 (4)다. 대응(어느 버튼이 어느 액션인지)은 **내가 정했다**(사용자 확인 없음). 점수판 "Gamepad": none → gated. 장면 문법·가이드·경고는 바뀌지 않았다(게임패드는 플레이어만의 일이고 시뮬레이션은 여전히 여섯 액션의 down/up만 본다).

- **대응**: Gamepad API의 standard 배치 기준. 십자키(버튼 12~15) 또는 왼쪽 스틱이 절반(0.5)을 넘으면 `up/down/left/right`, 버튼 0은 `a`, 버튼 1은 `b`. 연결된 패드 전부를 합친다(어느 패드든 누르면 눌린 것).
- **구조**: `web/player.ts`의 `pads()`가 프레임마다(그리고 `kiln.runTo` 시작 때) `navigator.getGamepads()`를 읽고, 지난번과 달라진 액션만 `press()`로 넘긴다. 그래서 키보드·터치와 같은 입력 줄(`TICK ACTION down|up`)로 기록되고 헤드리스에서 그대로 재생된다. 다시 시작(`reset`)하면 패드 기억(`padWas`)도 지워져, 누르고 있던 방향이 다음 프레임에 다시 들어간다.
- **테스트 1개 추가(162개)**: `tests/browser.test.ts`가 가짜 패드(`navigator.getGamepads`를 바꿔 끼움)로 십자키, 문턱 아래 스틱(무시), 문턱 위 스틱(대각선), 버튼 둘, 패드가 사라질 때(누르던 것이 떼어짐)를 보고, 기록된 입력을 헤드리스로 재생해 같은 해시인지 본다.
- 조작 안내(`web/index.html`)에 한 줄을 넣었다.
- 2D Lite 엔진 바이트: 63,997 → **64,551 / 72,000**.
- **한계**: 실제 패드로 해 본 적이 없다(가짜 패드 테스트뿐). standard 배치가 아닌 패드(`mapping`이 빈 문자열)는 버튼 번호가 달라 엉뚱하게 눌릴 수 있다(검사하지 않는다). 아날로그 값은 없다(스틱은 문턱을 넘었는지만). 다시 대응시키기, 진동, 패드로 일시정지·다시 시작은 없다. 키보드와 패드로 같은 액션을 동시에 누르다가 한쪽을 떼면 떼어진 것으로 본다(입력원별로 세지 않는다). 프레임마다 읽으므로 한 프레임보다 짧은 누름은 놓칠 수 있다. `pads()`는 프레임마다 작은 객체 하나를 만든다((7)의 "틱당 할당 0"은 시뮬레이션 틱 기준으로 잴 것이고 이것은 프레임당이다).
- `npm test` → 162개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `491ac82`에서 `ci`(3 OS), `images`, `demo` 초록. 단 `ci`의 Windows 작업이 처음에 한 번 실패했다(이번 변경과 무관한 `browser: a built folder plays a physics scene...`에서 `Runtime.evaluate did not answer in 30000ms`). 실패한 작업만 다시 돌리니 통과했다. **Windows 러너에서 이 테스트가 가끔 시간 초과한다**는 것으로 적어 둔다(처음 본 것이다. 되풀이되면 그 테스트의 제한 시간이나 틱 수를 본다).

## 검증 (2026-11-27 17차: 레벨 간 상태)

C의 (3)이다. 문법·구성요소 이름·경고 번호는 **내가 정했다**(사용자 확인 없음). 점수판 "State carried between levels": none → gated.

- **`keep A,B`**(`levels` 주제, 새 주제다): 두 장면에 **같은 이름의 엔티티**가 있고 둘 다 `keep`에 그 구성요소를 적으면, `load:FILE`로 넘어갈 때 다음 장면의 그 엔티티가 앞 장면이 끝난 틱(load 이벤트가 난 틱)의 구성요소 값으로 시작한다. 자기 파일에 적힌 값은 덮인다. 스크립트가 만든 구성요소도 된다. `tiles`는 못 넘긴다.
- **`tally EVENT [n=0] [by=1]`**: 그 이름의 이벤트가 날 때마다 n이 by만큼 바뀐다(점수. `tally hit 3 -1`은 목숨 셋). 틱 끝(스크립트 post 뒤)에 그 틱에 난 이벤트를 센다(스크립트 pre가 낸 것도 포함. `step` 시작 때의 이벤트 개수부터 센다). 상태이므로 저장되고 해시에 들어간다. 같은 엔티티의 `label`에서 첫 `%`가 n으로 그려진다.
- **구조**: `src/scene.ts`의 `kept(world)`가 넘길 것을 장면 문법 텍스트로 만들고(`entity score` 줄과 `tally coin 2` 줄), `take(world, text)`가 받는다. `take`는 여기 있는 엔티티가 자기 `keep`에 적은 구성요소 줄만 남기고 나머지는 읽지 않고 버린다(플레이어에서는 주소로 들어오는 바깥 입력이라서). 헤드리스는 `run`의 `opts.kept` / `RunResult.kept`로 `--follow`가 넘기고, 플레이어는 load 이벤트가 난 틱에 `kept`를 잡아 `?scene=FILE&keep=...`로 넘긴다(플레이어는 그 뒤 0.6초 더 돌지만 넘기는 값은 그 틱의 것이다). 다음 장면에서 다시 시작(`reset`)하면 넘겨받은 값에서 다시 시작한다.
- **같은 해시**: 브라우저 테스트가 `level1`을 재생해 `level2`가 열리게 하고, 주소의 `keep` 값이 헤드리스 `kept`와 같고, 틱 600의 해시가 헤드리스 `run(level2, { kept, ticks: 600 })`과 같음을 본다. `--follow`의 마지막 해시가 같은 경로임은 헤드리스 테스트가 본다.
- 혼자 실행한 장면(`test level2.kiln`, `solve`, `scripts/hashes.ts`)은 자기 파일의 값에서 시작한다. `HASHES`는 두 줄(`level1`, `level2`)만 바뀌었다(점수 엔티티를 넣어서).
- **경고 K324**: `keep`이 그 엔티티에 없는 구성요소, 없는 이름, `tiles`를 적었을 때.
- **예제**: `examples/level1.kiln`·`level2.kiln`에 `score` 엔티티(`label Coins:_%` + `tally coin` + `keep tally`). 기준 이미지 `tests/images/level1@0.png`는 Linux CI가 다시 그린 것이다.
- **테스트 2개 추가(161개)**: `tests/m1.test.ts`(넘김·안 넘김·follow 해시·목숨·저장 왕복·`take`가 거르는 것·K324 세 가지), `tests/browser.test.ts`(위의 같은 해시, 다시 시작).
- **코어 가이드**: 새 주제 줄 하나가 들어가 한도를 넘어서 세 군데를 줄였다(`physics`·`view` 한 줄 소개, `trigger` 설명의 load 부분, `test`의 "(one scene, many checks)"). **테스트가 재는 길이는 5,597자쯤이고 한도는 5,600이다.** 알아 둘 것: 테스트는 같은 프로세스에서 앞선 테스트가 등록한 스크립트 구성요소까지 세므로 `node src/cli.ts guide`로 잰 값(5,527)보다 70자쯤 길다. 설명은 `guide levels`에 있다.
- 2D Lite 엔진 바이트: 62,183 → **63,997 / 72,000**.
- **한계**: 두 장면에 같은 이름의 엔티티와 같은 `keep`이 있어야 한다(타일에서 여러 개 찍혀 번호가 붙은 엔티티는 번호까지 같아야 한다). 값은 주소에 실려 가므로 플레이어가 고칠 수 있고(검증 없음) 탭을 닫으면 사라진다(디스크·localStorage 저장 없음). `tally`는 이벤트 이름만 본다(누가 냈는지 모름). 한계값이 없어 목숨이 0 아래로 내려가고, 0이 됐을 때 하는 동작도 없다(스크립트나 `expect`로 본다). `solve`는 넘겨받은 값을 모른다. 3D 장면에서는 `label`이 그려지는지 확인하지 않았다(`%`도 마찬가지). CLI에 넘길 값을 직접 주는 옵션은 없다(`--follow`로만).
- `npm test` → 161개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `26e3199`에서 `ci`(3 OS), `images`, `demo` 모두 초록. (`98c5c61`의 `images` 실패 하나는 기준 이미지를 받으려고 임시 브랜치에서 일부러 돌린 것이다.)
- 알아 둘 것: (1) 이 환경의 Bash heredoc은 역슬래시 두 개를 하나로 바꾼다. 역슬래시가 든 코드는 Write/Edit로만 쓴다(이번에 두 번 깨져서 Edit로 고쳤다). (2) 기준 이미지를 받을 때 임시 브랜치로 **전환하지 않아도 된다**: main에 로컬 커밋 → `git push origin HEAD:refs/heads/tmp-NAME` → `gh workflow run images --ref tmp-NAME` → 아티팩트를 받아 넣고 `git commit --amend` → main push → `git push origin :tmp-NAME`. 기준과 "다르다"로 실패해도 아티팩트는 올라온다.

## 검증 (2026-11-27 16차: 빌드 바이트 줄이기, 스프라이트 애니메이션)

C의 둘째·셋째 덩어리다. 문법·경고 번호·새 예산 수치는 **내가 정했다**(사용자 확인 없음).

**1. `build`가 엔진 파일을 줄여 싣는다 (커밋 `6176454`, CI 셋 다 초록)**

- `src/squeeze.ts`의 `squeeze`: 글자 단위로 훑으며 주석, 줄 앞 들여쓰기, 줄 끝 공백, 빈 줄을 지우고 연속 공백을 하나로 줄인다. 따옴표 문자열·템플릿 문자열(`${}` 중첩 포함)·정규식 안은 그대로 복사한다. 줄바꿈은 남기고(세미콜론 자동 삽입이 같은 줄을 본다) 이름과 토큰 순서는 그대로다. 최소화기가 아니다.
- 엔진 파일(`engine/**`, 백엔드 어댑터 포함)에만 쓴다. 게임 자신의 스크립트(`game/*.js`)는 쓴 그대로 나간다(남의 코드에 정규식 판별이 틀릴 위험을 지지 않으려고).
- 측정: 2D Lite 93,775 → **61,108**, 3D Lite → 90,484, 전부(Standard) → 4,491,655.
- 예산을 조였다: `BUDGET = { lite2d: 72_000, lite3d: 102_000, standard: 4_630_000 }`(`tests/edition.test.ts`, `tests/proof.test.ts`의 Lite 상한도 72,000). 2D는 남은 Lite 행(게임패드·오디오·UI 등)에 쓸 약 1만 바이트를 남긴 값이다. `docs/EDITIONS.md`·`docs/PARITY.md`에 반영했다.
- 지키는 것: 새 테스트 하나(`tests/edition.test.ts`의 squeeze 테스트)가 까다로운 입력의 기대 출력을 고정하고, `src/`·`web/`·`backends/rapier/index.ts`의 모든 모듈이 줄인 뒤에도 `node --check`를 통과하고 템플릿 밖에 들여쓰기·빈 줄이 없음을 본다. 동작은 빌드한 게임을 헤드리스 해시와 비교하는 기존 브라우저 테스트가 지킨다.
- 한계: 정규식인지 나눗셈인지는 앞 토큰으로 추정한다(`)`·`]`·이름 뒤는 나눗셈). `if (x) /re/.test(y)` 꼴은 틀리게 읽는다. 지금 엔진에는 그런 코드가 없고, 있으면 `node --check` 테스트가 대개 잡지만 구문은 맞고 뜻만 바뀌는 경우까지 잡는다는 보장은 없다. 압축(gzip) 크기는 재지 않았다.

**2. 스프라이트 애니메이션 `anim` (점수판 "Sprite animation": none → gated)**

- **`anim FRAMES [fps=8] [idle=0] [face=1]`**(`view` 주제): `sprite image`가 같은 크기 프레임을 가로로 FRAMES개 늘어놓은 그림이다. 프레임은 `frameOf`(`src/sim.ts`)가 `floor(tick*fps/hz)`와 상태로만 정한다. `idle=N`이면 서 있을 때 앞 N칸, `vel`의 x나 y가 0이 아닐 때 나머지 칸을 돈다. `idle=0`이면 전체를 계속 돈다.
- **`face`는 상태다**(1 오른쪽, -1 왼쪽): `step`이 스크립트 pre 다음, 중력 앞에서 `vel.x`의 부호로 갱신한다(벽에 막혀도 누른 방향을 본다). 저장되고 해시에 들어간다. 왼쪽이면 플레이어가 그림을 좌우로 뒤집는다. 기존 장면은 `anim`이 없어 해시가 그대로다(`HASHES`는 `stroll` 한 줄만 늘었다).
- **설계안과 달라진 점**: 그리기는 원본 사각형(drawImage 9인자)이 아니라 "한 프레임 너비의 창(clip) 뒤에 시트 전체를 그리기"다. 자체 크기가 없는 SVG(viewBox만 있는 것)는 Chrome에서 `naturalWidth`와 원본 사각형 좌표가 맞지 않아 엉뚱한 칸이 나왔다(브라우저 테스트가 잡았다).
- **경고**: K320(frames·fps가 1 미만이거나 idle이 frames 이상), K321(sprite에 image가 없음), K322(idle이 있는데 vel이 없음), K323(3D 장면에서 anim), `sprite` 없는 `anim`은 K310.
- **예제 `examples/stroll.kiln`**(+`stroll.input`, `walker.svg` 4프레임, `bat.svg` 2프레임 — 전부 손으로 썼다): 주인공은 `idle=1`, 박쥐는 `pace`로 오가며 계속 날갯짓한다. 기준 이미지 `tests/images/stroll@150.png`는 Linux CI가 그린 것이다(틱 150: 주인공이 왼쪽을 보며 걷는 중).
- **테스트 2개 추가(159개)**: 헤드리스(`tests/m1.test.ts`: 틱별 프레임·방향, 저장 왕복, face가 해시에 들어감, frames=0에서 0으로 나누지 않음, 경고 다섯 가지)와 브라우저(`tests/browser.test.ts`: 프레임마다 단색인 시트로 여섯 틱의 색을 세고, 반은 초록·반은 파랑인 프레임으로 뒤집힘을 본다).
- 가이드: 코어 가이드는 5,597자쯤이다(한도 5,600. `view` 주제의 한 줄 소개를 줄여 맞췄다). 설명은 `guide view`에 있다.
- 2D Lite 엔진 바이트: 61,108 → **62,183 / 72,000**.
- 한계: 시트는 한 줄뿐이다(이름 붙은 클립, 여러 줄 아틀라스, 프레임별 시간, 프레임 이벤트 없음). 걷기 시작할 때 주기가 처음부터가 아니라 그때의 틱 위상에서 시작한다(상태를 두지 않은 대가). "움직임"은 `vel`이 0이 아닌지만 본다(벽에 대고 걸어도 걷는 그림, 중력으로 떨어져도 걷는 그림). 위·아래 방향 그림은 없다. 3D에서는 안 그린다. 타일은 여전히 움직이지 않는다.
- `npm test` → 159개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `b2be608`에서 `ci`(3 OS), `images`, `demo` 모두 초록. (`b0d846a`의 `images` 실패 하나는 기준 이미지를 받으려고 임시 브랜치에서 일부러 돌린 것이다.)
- 알아 둘 것: `node --test --test-name-pattern=... tests/*.test.ts`처럼 전 파일에 이름 패턴을 걸면 3분이 넘도록 안 끝났다(원인은 보지 않았다). 한 파일만 지정하면 바로 끝난다.

## 검증 (2026-11-27 15차: 타일 문자별 색·이미지, `#` 경고)

C의 첫 덩어리다. 점수판 2D 표의 "Per-tile color and image" 행을 none → gated로 옮겼다. 문법과 경고 번호는 **내가 정했다**(사용자 확인 없음).

- **`tiles ... paint=CHAR:COLOR,CHAR:IMAGE`**: `tiles`의 마지막 필드(`src/world.ts`). 값이 이미지 확장자(svg·png·jpg·webp·gif)로 끝나면 이미지, 아니면 CSS 색이다. 2D는 색과 이미지를 다 그리고, `.`도 칠할 수 있다(칠하지 않은 `.`은 전처럼 빈칸). 3D는 두 렌더러 모두 색만 쓴다(칸이 상자라서). 표 해석은 `paintOf`(`src/scene.ts`, 문자열별로 한 번만 읽는다)이고 플레이어와 `lint`가 같이 쓴다. 기본값이 빈 문자열이라 기존 장면의 직렬화·해시는 그대로다(`HASHES`는 `garden` 한 줄만 늘었다).
- **검사**: 형식이 틀린 항목은 오류 K104. 경고는 K317(어느 행에도 없는 문자를 칠함), K312(이미지 파일 없음), K318(3D 장면에서 이미지를 칠함).
- **`#`**: `tiles` 줄은 원래부터 `#`를 그대로 뒀다(알려진 한계의 그 문장은 낡은 것이라 지웠다). 실제로 잘리던 곳은 다른 줄이었다. 이제 `glyph=#`처럼 **이름을 붙인 값의 `#`는 값이다**(주석 정규식에 `(?<!=)`). 이름 없이 `sprite # red`라고 쓰면 여전히 주석이고, `check`가 K319로 알린다(구성요소의 첫 필드가 선택형 문자열일 때만. `sprite @ # 주석`은 경고하지 않는다). K319 검사는 장면 원문이 필요해서 `lint`가 네 번째 인자로 원문을 받는다.
- **예제 `examples/garden.kiln`**(+`garden.input`은 `solve`가 만든 것, `grass.svg`는 손으로 썼다): 울타리·물·다리는 색, 빈칸은 풀 이미지, 물은 `solid=#~`로 막는다. 기준 이미지 `tests/images/garden@60.png`는 Linux CI가 그린 것이다.
- **기준 이미지를 main을 빨갛게 하지 않고 받는 법**: 임시 브랜치에 push → `gh workflow run images --ref 브랜치` → 그 실행은 "has no reference image" 하나로 실패한다 → `gh run download <id> -n images`로 받아 `tests/images/`에 넣고 → main에 올린다 → 임시 브랜치 삭제.
- 테스트 3개 추가(156개): 파서·직렬화·경고(`tests/m1.test.ts` 2개), 브라우저(`tests/browser.test.ts`: 2D에서 칠한 색마다 칸 수를 픽셀로 세고, 안 칠한 벽 색이 0인지 보고, 3D 두 렌더러에서 `#:red`가 화면의 5% 이상을 붉게 만드는지 본다).
- **예산이 거의 찼다. 다음 덩어리 전에 읽을 것.**
  - 2D Lite 엔진 바이트: 92,292 → **93,775 / 94,000**(남은 것 225바이트). 처음 쓴 코드는 94,679로 예산을 넘겨서, K319 검사를 플레이어에 실리지 않는 `lint.ts`로 옮기고 플레이어 코드를 줄여 맞췄다. 예산은 올리지 않았다(EDITIONS: "처음 잰 값에서 정하고, 일부러 조일 때만 바꾼다").
  - 스프라이트 애니메이션·오디오·게임패드·UI는 플레이어 코드가 늘어서 이대로는 예산에 안 들어간다. **내 권고**: 예산을 올리지 말고 `build`가 실제로 싣는 바이트를 줄인다. 내보낸 파일은 타입만 지운 원문이라 주석과 타입 자리의 공백이 그대로 실린다. 줄 전체가 주석인 줄과 줄 끝 공백을 지우면 줄어든다(템플릿 문자열 안의 줄 — `web/gpu.ts`의 WGSL — 은 건드리지 않게 백틱 짝을 세고, 빌드한 게임이 헤드리스와 같은 해시를 내는 기존 브라우저 테스트로 지킨다). 얼마나 줄어드는지는 아직 재지 않았다. 그래도 모자라면 오디오 같은 것을 3D 렌더러처럼 "쓰는 게임만 싣는 부품"으로 뺀다.
  - 코어 가이드: 테스트 한도 5,600자에 지금 5,596자쯤이다(`tiles` 설명 문구를 줄여 맞췄다). 새 구성요소는 주제 가이드(`view` 등)에 넣는다.
- 한계: 문자 하나에 이미지 하나다(아틀라스·자동 타일링·움직이는 타일 없음). 색 값에 쉼표를 못 쓴다(`rgb(1,2,3)` 불가, 이름이나 `#hex`만). 3D에서 이미지는 안 그린다. 이미지를 칸마다 0.5px 겹쳐 그려서 풀 무늬 사이에 옅은 이음매가 보인다. K319는 `sprite # red` 꼴만 잡는다.
- `npm test` → 156개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `b2070a3`에서 `ci`(3 OS), `images`, `demo` 모두 초록.

## 검증 (2026-11-27 14차: 같은 명세로 Godot 실행과 Kiln 재실행)

B의 (d)(e)다. 실행 조건은 **내가 정했다**(사용자 확인 없음). 전문은 `proof/lite/COMPARE.md`.

- **세 실행, 각 1회**(전부 헤드리스 Claude Code 2.1.330, `claude-sonnet-5-5`, 파일 도구 Read·Write·Edit·Glob, 빈 `game/`):

  | | Kiln 1차(10차) | Kiln 2차 | Godot 4.7.2 |
  |---|---|---|---|
  | 스스로 종료 | 예 | 예 | 예 |
  | 시간(그중 모델 대기) | 7분 4초 | 3분 36초(2분 52초) | 28분 47초(4분 27초) |
  | 턴 / 도구 호출 | 105 / 104 | 44 / 43 | 45 / 44 |
  | 출력 토큰 / 입력 토큰 | 37,711 / 794,808 | 23,980 / 263,757 | 39,061 / 723,024 |
  | API 가격 | $0.73 | $0.43 | $0.73 |
  | 실패로 돌아온 호출 / 고쳐야 했던 것 | 7 / 7 | 1 / 0 | 4 / 0 |
  | 결과물 | 14파일 12,595바이트 | 11파일 8,365바이트 | 8파일 29,742바이트 |

- 실패를 하나씩 읽은 결과: Kiln 2차의 1건은 에이전트가 원한 답이다("상자를 고정하면 `solve`가 보석에 못 닿는다"). Godot의 4건 중 2건은 하네스가 거부한 셸 줄(파이프, `$LASTEXITCODE`), 2건은 에이전트가 자기 테스트가 경고에 실패하는지 보려고 일부러 심은 것이다. **엔진이 에이전트를 막은 것은 Kiln 1차뿐이다.**
- Godot 에이전트는 규칙 코드, 입력 탐색기(`tools/solve.gd`), 검사 48개짜리 테스트 러너를 전부 직접 썼다. Kiln 2차는 스크립트 없이 장면 4개와 입력만 썼고, 12차의 케이스 입력과 `--follow`를 스스로 썼다(B·C·D용 레벨 복사본이 없어졌다).
- **Godot 실행 방법**: zip의 SHA-512가 공식 값과 일치함을 확인한 뒤 `out/godot/`(gitignore)에 풀었다. 이 Claude Code에는 Windows에서 Bash 도구가 없다(`--tools`에 Bash를 줘도 빠진다). `--tools "Read,Write,Edit,Glob,PowerShell" --allowedTools "PowerShell(godot:*)"`로 주고, PATH 앞에 `godot.cmd`(콘솔 실행 파일을 부르는 한 줄)가 든 폴더를 넣었다. Git Bash에서 PATH에 넣을 때는 `/c/...` 꼴로 적는다(`C:/...`는 콜론에서 잘린다). 읽기 전용 PowerShell 명령(`Get-ChildItem` 등)은 허용 목록 없이도 실행된다. 프롬프트는 COMPARE.md에 있다.
- **무효 처리한 첫 Godot 시도**: Bash 도구가 없어 에이전트가 Godot을 한 번도 못 돌렸다(3분 31초, 눈 감고 작성, 스스로 "증명하지 못했다"고 보고). 내 설정 실수라 표에 넣지 않았고 COMPARE.md에 적었다.
- 사후 검증: Kiln 2차 결과물은 `proof/lite/rerun/`에 그대로 두고 `tests/proof.test.ts`가 지킨다(폴더 test 7개, `--follow` 1→끝, Lite 검사). Godot 결과물은 `proof/lite/godot/`(`.godot` 캐시 제외)에 두고 저장소 사본에서 테스트 명령을 다시 돌려 48개 통과·종료 코드 0을 확인했다. **CI는 Godot 게임을 돌리지 않는다**(Godot이 없다). 명세의 최소 크기는 두 결과물 모두 직접 세어 확인했다.
- `scripts/agentcost.ts`: 셸 호출을 프로그램 이름으로 묶고(`shell godot`), Godot 실행은 엔진 오류 줄이나 0이 아닌 종료 코드를 실패로 센다. 테스트 1개 추가.
- 한계(COMPARE.md에 더 있다): 각 1회라 편차를 모른다. Kiln 2차는 엔진 수정과 모델의 다른 뽑기가 섞여 있고 레벨도 더 단순하다. 명세를 Kiln이 썼다(녹화 입력·테스트 명령·폴더 통과는 Kiln이 가진 것이다). Godot 게임은 아무도 화면으로 보지 않았고 프레임 속도·내보내기 크기를 재지 않았다. 두 번째·Godot 실행의 에이전트가 한국어로 답했다(기계의 어떤 설정이 닿았다는 뜻이다. 도구 구성은 같다).
- 로그는 스크래치패드에만 있다(절대경로가 들어 있어 저장소에 넣지 않았다).
- `npm test` → 153개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `f804a7b`에서 `ci`(3 OS), `images`, `demo` 모두 초록.
- 세션 메모: 이 세션(13~14차)은 다른 세션이 시작한 세션이라 앱이 `start_session`의 직접 시작(`user_asked`)을 거부했다("Start sessions only on the user's own words"). 그런 세션에서는 제안 카드(`own_initiative`)만 낼 수 있다.

## 검증 (2026-11-26~27 13차: Lite 증명 게임 프레임 속도)

B의 (c)다. 설정 네 가지와 판정 방식은 **내가 정했다**(사용자 확인 없음).

- **`bench/frames.ts`**: 창이 있는 실제 Chrome(헤드리스 아님)에서 `proof/lite/game`의 레벨 1~3을 녹화 입력으로 재생하며 프레임마다 시간을 잰다. `bench/PROTOCOL.md`대로 워밍업 5초 뒤 60초, 설정마다 3회, 전부 보고. 플레이어 코드는 고치지 않았다: 밖에서 `requestAnimationFrame`을 감싸 재고, 레벨의 load 틱 20틱 전에 `kiln.reset()`으로 처음부터 다시 돌려 60초를 채운다. 결과 `proof/lite/FPS.md`(스크립트가 쓴다, 손으로 고치지 않는다), 프레임별 원자료 `bench/raw/*.json.gz`(24개, 788KB, 커밋함), `--summary 파일`로 한 줄을 다시 계산한다. `--only 설정`은 그 설정만 다시 재고 나머지는 원자료에서 읽어 표를 다시 만든다.
- `src/chrome.ts`에 더한 것: `launch({ window })`(창 있는 브라우저), `open(url, null)`(창 크기 그대로), `page.send`(DevTools 호출).
- **결과(이 PC: i5-12500H, Iris Xe가 144Hz 화면 구동, 전원 연결, 균형 모드, Chrome 158, 게임 화면 924x705, Canvas 2D)**:
  - `display`(수직동기 켬, 9회): 평균 144.0fps, 1% Low 124~133, **77,764프레임 중 16.67ms를 넘은 것 0개**.
  - `uncapped`(수직동기·상한 끔, 9회): 평균 669~1,202fps, 1% Low 312~384.
  - `software`(`--disable-gpu`, 레벨 3, 3회): 평균 606~640fps, 1% Low 247~303. Lite 기준 기계("WebGPU를 끈 기준 PC") 대신이다. 이 게임은 Canvas 2D라 WebGPU를 애초에 부르지 않는다.
  - `software-slow4`(위에 DevTools CPU 4배 감속, 3회): 평균 150~169fps, 1% Low 52 / 76 / 68. **한 번은 60 아래**(9,019프레임 중 71개가 16.67ms 초과). 느린 기계 흉내일 뿐 휴대폰이 아니다.
- CI가 지키는 것: 시간은 CI에서 못 재므로 `tests/proof.test.ts`에 "레벨 3 한 프레임의 Canvas 2D 호출 ≤ 90"(지금 81)을 더했다.
- 점수판: 증명 게임 행을 "works (Lite, on the PC; no phone)"로 올렸다. **gated가 아니다**: 실제 휴대폰에서 재지 않았다.
- 한계: 휴대폰 미측정. GPU 프레임 시간 없음(Canvas 2D에는 타임스탬프 쿼리가 없다). 브라우저 시계가 0.1ms 단위라 0.2ms 아래 프레임은 평균만 믿을 수 있다. 잰 것은 `play`가 내보내는 플레이어(옆 패널 포함)이고 빌드 폴더·레벨 전환·엔딩 화면은 재지 않았다. 다른 엔진과의 비교가 아니다.
- **측정 중에는 창이 앞에 있어야 한다.** 첫 시도에서 두 번이 60초 중 18초·26초만 덮였다(창이 가려져 그리기가 멈춤). 지금은 스크립트가 그런 실행을 거부하고 다시 잰다(최종 측정에서 1번 재시도). 전체는 약 30분이고 그동안 다른 부하를 주지 않았다.
- **알게 된 것: 이 PC에는 NVIDIA RTX 3050 Ti Laptop GPU도 있다**(화면은 Iris Xe가 구동, Chrome도 Iris Xe를 쓴다). "외장 GPU가 있는 기계가 없다"는 아래 기록과 다르다. Ultra 기준 기계 후보가 될 수 있으니 사용자에게 확인할 것(이 PC가 HANDOFF가 말하는 "기준 PC"와 같은 기계인지도).
- (d) 준비: Godot 4.7.2 공식 체크섬을 받아 두었다. `Godot_v4.7.2-stable_win64.exe.zip`의 SHA-512는 `83decd58fdf67b9d657958a1ae6bf1929c20785315a81effe245874cdc57acb709bf868e00778a96984338c1b29dafdb453c6847747694621c6ecf5da2259993`이어야 한다(출처: godotengine/godot-builds 릴리스 4.7.2-stable의 SHA512-SUMS.txt). **로컬 zip의 해시는 아직 대조하지 않았다.** 헤드리스 Claude Code는 여전히 `%APPDATA%/Claude/claude-code/2.1.330/` 아래에 있다.
- `npm test` → 151개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `6603005`·`64030ca`에서 `ci`(3 OS)와 `images` 초록. `demo`는 두 번 Pages 배포 단계에서 GitHub 쪽 오류("Deployment failed, try again later", "Fetching artifact metadata failed")로 실패했고, 몇 분 뒤 `gh workflow run demo`로 새로 돌린 실행(`64030ca`)은 초록이다. 실패한 작업만 다시 돌리면(`gh run rerun --failed`) `github-pages` 아티팩트가 둘이 되어 또 실패하니 새 실행으로 한다. `spikes` 워크플로(필수 아님)는 `src/chrome.ts`가 바뀌면 돌고, Windows 소프트웨어 WebGPU 어댑터가 없어 이전 커밋들부터 계속 빨갛다.

## 검증 (2026-11-26 12차, 이전 기록: 장면은 load에서 끝난다, `--follow`, 케이스 입력)

B의 (b)다. 설계는 **내가 정했다**(사용자 확인 없음). 새 expect 문법은 만들지 않았다.

- **장면은 `load:FILE` 트리거가 발동한 틱에 끝난다**(`src/run.ts`). 헤드리스 실행이 거기서 멈추고 마지막 줄에 `load=FILE`을 붙인다. 플레이어(브라우저)와 같은 의미다. 끝난 뒤의 `count NAME OP V at N`은 최종 개수로 판정하고(이벤트가 더 생길 수 없으므로), `at N A.comp.field`는 "scene ended at tick T (load FILE), before tick N"으로 실패한다. 그래서 `count caught == 0 at 886` 같은 손으로 읽은 틱이 필요 없다(`at 900`처럼 넉넉히 적으면 된다).
- **`--follow`**(MCP `follow: true`, `test`·`run`): load된 장면으로 넘어가 그 장면의 `NAME.input`으로 계속한다. 장면마다 `scene NAME tick= hash= passed= load=` 한 줄, 마지막 줄에 `path=a.kiln>b.kiln`. 실패한 장면에서 멈춘다. 자기 자신을 load하는 장면은 64장면 뒤 `E K132`, 대상 파일이 없으면 `E K001`, 장면 텍스트(파일 아님)에는 `E K002`. 장면 사이에 상태는 넘기지 않는다(플레이어도 안 넘긴다).
- **케이스 입력**: 입력 파일에 `expect` 줄을 적으면 그 실행에서는 장면의 expect를 **대신한다**. `test DIR`은 장면마다 `NAME.input`으로 한 번, 옆의 `NAME.CASE.input`마다 한 번 더 돈다(같은 이름의 `NAME.CASE.kiln`이 있으면 그 장면의 입력으로 본다). 요약 줄은 케이스가 있을 때만 `scenes=N cases=M passed= failed=`다. 실패 줄의 파일:줄은 입력 파일 기준이다. `parseInput`은 `expect` 줄을 건너뛴다(`play --input`·`look --input`이 케이스 파일을 받아도 된다. 브라우저는 그 expect를 평가하지 않는다).
- **`solve`**: load가 일어난 가지는 거기서 끝이다. 그 틱에 목표가 다 찼으면 답이고 아니면 버린다. 전에는 레벨을 다시 시작시키는 트리거를 뚫고 지나간 답이 나올 수 있었다. 상태 수는 그대로다(예제 level1 586, 증명 게임 level2 7,987).
- 바뀐 해시 하나: `examples/level1.kiln`이 tick 600 → 187(계단에서 끝남), 해시 `7b184b77` → `2cafa95c`. 의도한 변화라 `examples/HASHES`를 갱신했다. 나머지 17개는 그대로.
- `proof/lite/game/`은 고치지 않았다. 대신 `tests/cases.test.ts` 11개가 지킨다: load 틱에서 멈춤, 마지막 줄의 `load=`, 끝난 뒤 count·at 판정, 입력의 expect가 장면 것을 대신함, `test DIR`의 케이스, `--follow` 성공·실패·무한 반복·없는 파일, solve가 load를 뚫지 않음, **에이전트가 레벨을 복사해 증명한 B·C·D가 원본 레벨에 케이스 입력으로 그대로 통과**(test_crate의 `mark` 엔티티 expect 하나만 뺐다. 옆의 위치 검사가 같은 말을 한다), 증명 게임을 한 명령으로 1→2→3→엔딩. 새 장면은 `tests/fixtures/chain/`(room·end·`room.trap.input`)과 `tests/fixtures/loop/`, 예제 `examples/level1.wait.input`.
- 가이드: `test` 줄에 케이스 입력과 `--follow`를 넣고 다른 곳(tiles·sprite·trigger·pace 설명, look·expect 줄)을 줄였다. **예산 테스트는 CLI 출력보다 70자쯤 크게 잰다**(같은 테스트 파일의 앞선 테스트가 스크립트 컴포넌트를 레지스트리에 등록해서다). CLI로 5,525자, 테스트 기준 5,595자(예산 5,600 미만). 다음에 문구를 더하려면 CLI 기준 5,529자까지만 된다.
- 한계: 케이스 입력은 엔티티를 더하지 못한다(expect만). `--follow`는 장면마다 그 장면의 `NAME.input`만 쓴다(장면별 케이스를 이어 붙이지 못한다). `solve`는 여러 장면을 이어 풀지 않는다.
- `npm test` → 150개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 18개 일치(level1 갱신 후). `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `8d13dd2`에서 `ci`(3 OS), `images`, `demo` 모두 초록.
- 셸 heredoc 안의 node 스크립트도 `\n`·`\\`가 깨진다(작업 규칙의 파이썬 얘기와 같다). 이번에 두 번 걸렸다. 역슬래시가 든 수정은 Edit/Write 도구로 한다.

## 검증 (2026-11-26 11차, 이전 기록: solve가 벽을 돌아가고 금지 이벤트를 지킨다)

- 10차 커밋 둘(`430be17`, `9d78d66`)은 CI 세 개(`ci`, `images`, `demo`) 모두 초록이었다.
- 재현: 에이전트가 막혔던 레벨을 `tests/fixtures/vault.kiln`(+`vault.ts`)로 고정했다. 고치기 전에는 에이전트가 본 것과 같은 그림으로 20만 상태 뒤 포기했다. 원인은 `solve`의 거리가 직선이라, 아직 닫힌 문 뒤의 출구가 가장 가까운 목표가 되어 문 앞에 붙어 있던 것이다.
- 고친 것(`src/solve.ts`) 셋: (1) **경로 거리** — 탑다운(점프 없음, xy 평면) 타일 맵이 있으면 "직선 간격 + 벽 때문에 늘어난 칸 수 × 칸 크기"를 쓴다. 벽은 첫 맵의 solid 타일과 움직일 수 없는 solid 엔티티(문)다. 길이 없는 목표는 2^27을 더해 걸어갈 수 있는 목표보다 뒤로 민다. 거리장은 (고정 solid 집합, 목표 칸)마다 한 번 계산해 캐시한다. (2) `gone #tag`는 남은 개수를 순위에 넣는다(목표 하나보다 낮은 자리). (3) **금지 이벤트** — `count NAME == 0 at N`(`<= 0`, `< 1`도)을 `never`처럼 취급해 N틱까지 그 이벤트를 낸 가지를 버린다. 새 문법은 만들지 않았다(에이전트가 스스로 쓴 형태 그대로). 가이드의 solve 줄에 반영했다(5,522자, 예산 5,600).
- 상태 수(전→후): vault 포기→7,987 / 증명 게임 level1 2,561→211, level2 31,789→7,987, level3 113,574→18,516 / 예제 dungeon 767→192, cave 908→267, platformer 2,365→256, level1 631→586, quest 12,308→11,919, sokoban 3,000·gauntlet 549·maze 133·lift 214는 그대로. 처음 시도한 "칸 수 × 칸 크기" 방식은 sokoban을 3,000→21,822로 악화시켜 버렸다(칸 단위로 뭉개져 동률이 많아짐).
- 한계: 경로 거리는 탑다운 타일 맵에서만 쓴다(플랫포머·3D는 직선 그대로). 밀 수 있는 상자는 벽으로 보지 않는다. 움직이는 경비의 위상마다 상태가 달라 병합이 안 되는 것은 그대로다(level2가 아직 1만 상태).
- `tests/solvepath.test.ts` 5개: vault가 2만 상태 안에 풀리고 재생이 통과, 증명 게임 레벨별 상태 예산, 금지 이벤트가 답을 돌아가게 함, 허용하는 count는 탐색을 바꾸지 않음, 길이 금지 이벤트뿐이면 실패를 말함.
- `npm test` → 139개 통과(이 PC, 건너뜀 0). `node scripts/hashes.ts --check` → 18개 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 `6e75380`에서 `ci`(3 OS), `images`, `demo` 모두 초록.
- 사용자 지시(2026-11-26 추가): **묻지 말고 알아서 정해 진행하고, 사용자가 정한 조건(5시간 98%) 외에는 멈추지 않는다.** 새 세션을 열지 물어보지 않는다. **"새 세션에서 이어가길 권한다"고 말하고 끝내지도 않는다**(사용자가 다시 지적함: "너가 알아서 새 세션 열어야지"). 토큰 가드 경고가 오거나 컨텍스트가 15만 토큰을 넘은 채 덩어리가 끝나면, HANDOFF를 갱신·push한 뒤 `start_session`(fresh, 브리프에 이 문서 경로와 다음 일)으로 직접 다음 세션을 연다.

## 검증 (2026-11-26 10차, 이전 기록: 실제 에이전트 연결)

- **처음으로 실제 에이전트가 MCP로 Kiln을 썼고, 명세만 보고 게임을 끝까지 만들었다.** 명세는 `proof/lite/SPEC.md`(Gem Vault: 탑다운 3레벨+엔딩, 보석을 다 모아야 열리는 문, 순찰 경비, 밀어야 하는 상자, 완료 조건 A~F). 전체 기록은 `proof/lite/RUN.md`.
- 실행 방법: 앱에 번들된 Claude Code 2.1.330(`%APPDATA%/Claude/claude-code/<버전>/<해시>/claude.exe`, PATH에는 없다)을 저장소 밖 빈 폴더에서 `-p --model sonnet --mcp-config <kiln 서버> --strict-mcp-config --setting-sources project --tools "Read,Write,Edit,Glob" --allowedTools mcp__kiln__kiln --permission-mode acceptEdits --disable-slash-commands --output-format stream-json --verbose --no-session-persistence < /dev/null > LOG.jsonl`로 띄웠다. 이렇게 하면 사용자 설정·훅·플러그인·CLAUDE.md 없이 기본 오버헤드가 약 7,500토큰이다. 로그에는 이 PC의 절대경로가 들어 있어 저장소에 넣지 않았다(스크래치패드에만 있고 사라질 수 있다).
- 에이전트 비용(Sonnet 5.5, 1회): 스스로 종료, 7분 4초, 105턴, 출력 37,711토큰, 입력 794,808토큰(새로 읽은 것 69,008 + 캐시 재독 725,800), API 가격으로 $0.73, 도구 호출 104회, **사람 없이 고친 실패 7건**(solve 3, test 3, Edit 1).
- 실패에서 드러난 Kiln 쪽 문제 4종: (1) 가이드가 장면 확장자 `.kiln`을 말하지 않아 `.scene`으로 시작했다 → **가이드 첫 줄에 넣어 고쳤다**(5,507자, 예산 5,600). (2) `solve`가 보석 4개+움직이는 경비 2명인 레벨에서 20만 상태 뒤 포기했고 에이전트가 레벨을 고쳐 맞췄다. (3) `solve`에 "도중에 일어나면 안 되는 일"을 줄 방법이 `never A B`뿐이라 경비를 뚫고 가는 답이 나왔다. (4) `reach hero guard1`이 간격 0.00002로 실패했는데 트리거는 발동했다→ **고쳤다**: 원인은 트리거가 닿은 틱에 한쪽을 지워 `reach`가 잴 상자가 없던 것이고, 같은 이유로 `never hero #guard`가 경비에게 방금 지워진 hero에 대해 잘못 통과하고 있었다. `step`이 그 틱에 트리거가 잡은 쌍을 `world.met`(한 틱짜리, 상태·해시 아님)에 남기고 `reach`·`never`가 그것도 본다(`tests/contact.test.ts` 3개). (2)(3)도 **고쳤다**(아래 11차).
- 에이전트가 볼 수 없던 것: 헤드리스 실행은 `load` 이벤트만 내고 같은 장면을 계속 돈다. 그래서 "경비에 닿으면 레벨이 다시 시작"과 레벨 전환은 내가 브라우저 테스트로 따로 확인했다(`tests/proof.test.ts`: 1→2→3→엔딩, 경비→level2 재시작, 닫힌 문은 아무것도 열지 않음). 한 장면을 여러 입력·expect로 돌릴 방법이 없어 에이전트는 B·C·D 증명용으로 레벨을 복사한 장면 3개를 만들었다.
- **하지 않은 것**: 기준 기계 60fps 측정(WebGPU 끈 기준 PC, 휴대폰) — 그래서 Lite 증명 게임 행은 "works (built only)"다. 같은 명세의 Godot 구현과 비교. 두 번째 실행(편차를 모른다). 사람이 직접 해 보기.
- `npm test` → 134개 통과(이 PC, 건너뜀 0. 늘어난 12개: agentcost 3 + proof 6 + contact 3). `node scripts/hashes.ts --check` → 18개 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- 사용량: 이 덩어리 시작 때 5시간 한도 3%였다. 에이전트 실행 자체는 Sonnet이라 작다.

## 검증 (2026-11-26 9차, 이전 기록: 에디션 선)

- **`check`가 에디션을 계산한다**(`src/edition.ts`). 컴포넌트는 정의할 때 축과 에디션을 적는다(`defineComponent`의 다섯째 인자 `['physics', 'standard']`). 값이나 조합으로 정해지는 것은 `needs()`에 있다. 지금 축을 올리는 것: 물리 = `physics=rapier`·`rigid`·`impulse`·`force`, 그리기 = glTF 메시·`quat`·**3D 장면(`eye`가 있는 장면)의 `rot`**(WebGL2가 3D 회전을 안 그리므로 규칙 6에 따라 내가 Standard로 정했다. 사용자 확인은 없다). 월드·네트워크 축을 올리는 기능은 아직 없다.
- 출력: Lite가 아닌 축마다 한 줄(`physics standard: physics=rapier (line 4), 'rigid' (line 39, +4 more)`), 끝 줄에 `edition=standard`. Lite 장면은 줄이 늘지 않는다. `check DIR`은 폴더를 게임 하나로 보고 가장 높은 에디션을 말한다. `--edition lite`(MCP 인자 `edition`)를 넘는 사용은 전부 `E K140 파일:줄`로 나오고 종료 코드 2다. 스키마·가이드는 Lite가 아닌 컴포넌트에 `[standard]`를 붙인다.
- 예제 18개 중 Standard는 `gallery3d`·`orrery3d`·`tumble3d` 셋이고, 이는 `scripts/images.ts`가 WebGPU 전용 기준 이미지(`'own'`)를 쓰는 장면과 정확히 같다. 테스트가 이 일치를 본다(규칙 6의 검사).
- **`build`가 쓰는 부품만 싣는다.** 플레이어가 두 렌더러와 glTF 리더를 `import()`로 필요할 때만 읽고, `build`는 게임 폴더에 든 것으로 정한다: 장면에 `eye` 줄이 있거나 스크립트에 따옴표 친 `eye`가 있으면 `3d`(gl·gpu·mesh), 모델 파일(.gltf/.glb)이 있으면 `gltf`, 장면이 백엔드를 이름 대면 그 백엔드. CLI 끝 줄이 `engine_bytes=`와 `parts=`를 말한다.
- 엔진 바이트 실측과 예산(`tests/edition.test.ts`의 `BUDGET`): 2D Lite 90,703(예산 94,000), 3D Lite 128,480(133,000), 전부 든 Standard 4,537,594(4,680,000). 타입만 지운 소스 그대로이고 압축·최소화 전 값이다.
- 브라우저 테스트(이 PC의 Chrome): 부품 없이 빌드한 2D 게임과 3D Lite 게임이 헤드리스와 같은 해시에 닿는다(2장면, 90틱, 입력 없음). 렌더러가 없는 빌드에서 3D 장면을 열면 상태는 그대로 맞고 2D로 그려지며 페이지가 `engine part missing from this build` 오류를 낸다.
- `npm test` → 122개 통과(이 PC, 건너뜀 0. 늘어난 11개: `tests/edition.test.ts` 10개 + 브라우저 1개). `node scripts/hashes.ts --check` → 18개 일치(시뮬레이션 코드는 건드리지 않았다). `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 ca7d2f6에서 `ci`(Linux·macOS·Windows), `images`, `demo` 모두 초록. 그 앞 커밋 6b6fd9e의 `demo`는 배포 단계가 "github-pages 아티팩트 없음"으로 실패했는데(빌드 단계는 통과, GitHub 쪽 오류 문구), 다음 실행에서 같은 워크플로가 통과했다.
- 가이드는 5,496자다(예산 5,600). 다음에 가이드에 글을 더하려면 무엇을 주제로 옮길지 먼저 정해야 한다.
- 같은 날 다른 세션이 에디션 이름을 Lite·Standard·Ultra로 바꾸는 문서 커밋(8752660)을 중간에 올렸고, 이 작업은 그 이름과 축 정의에 맞췄다.

## 검증 (2026-11-26 8차, 이전 기록: 강체 규모 측정)

- 측정(`node bench/physics.ts --write`, 기준 노트북, 지속 속도): 강체 N개 더미 + 그 사이를 걷는 캐릭터 4개. 틱 중앙값 50개 2.2ms, 200개 5.2ms, 500개 7.9ms, 1,000개 23.7ms, 2,000개 45ms. **60Hz에 드는 것은 500개 근처까지다.** 솔버(Rapier 스텝)가 70~80%, Kiln 쪽이 20~30%. 스냅샷은 1,000개에 2.5MiB·저장 6.5ms·복원 8ms(`solve`의 256MiB에 약 100개 들어간다).
- **이 노트북은 부하 3초쯤 뒤 CPU가 약 3배 느려진다**(같은 정수 루프가 80ms → 250ms. 직접 확인). 예전 `bench/PERF.md`는 빠른 구간에서 잰 값이었다. 다시 잰 값: 움직이는 상자 1,000개+고체 1,000개 3.3ms(예전 0.7ms), 10,000+5,000은 31ms로 60Hz에 들지 않는다(예전 7ms "든다"). README 문장도 고쳤다. 시간 수치를 비교할 때는 같은 구간에서 잰 것끼리만 비교한다.
- 측정으로 찾아 고친 것 세 가지, 전부 결과 비트는 그대로(벤치 해시 10개와 새 테스트 해시가 고치기 전 코드와 같다. `git stash`로 대조): (1) `physicsSync`가 틱마다 강체를 다시 읽지 않고 지난 스텝이 읽어 둔 값(`Link.seen`, 저장 안 됨, 복원 뒤 첫 틱은 다시 읽는다)과 비교한다. 틱당 `read`가 2N→N. (2) 어댑터의 `place`가 호출마다 하던 `propagateModifiedBodyPositionsToColliders`를 다음 `cast`·`save` 직전 한 번으로 미뤘다. (3) `cast`가 "새 강체"를 하나씩 물을 때 쓸고 가는 공간에서 닿을 수 없이 먼 것은 건너뛴다. 스크립트가 모든 강체를 매 틱 고치는 경우 500개 26.9ms → 11.1ms, 2,000개 181ms → 54ms.
- `npm test` → 111개 통과(이 PC, 건너뜀 0). 늘어난 1개: 스크립트가 매 틱 고치는 강체 24개 사이를 걷는 캐릭터가 강체에 파고들지 않고 밀며, 180틱 해시가 `2b87d1e3`(고치기 전 코드에서 뽑은 값).
- `node scripts/hashes.ts --check` → 18개 일치. `node scripts/images.ts` → 0 failed(이 PC는 참고 출력).
- CI: 커밋 accd3e6에서 `ci`(Linux·macOS·Windows, 새 고정 해시 `2b87d1e3` 포함), `images`, `demo` 모두 초록.

## 검증 (2026-11-26 7차, 이전 기록: 강체가 캐릭터를 민다)

- `npm test` → 110개 통과(이 PC, 건너뜀 0). 늘어난 1개: 강체가 캐릭터에 부딪히면 캐릭터가 밀린다(무거운 공 2.6이 가벼운 공 0.1보다 5배 넘게 민다, 반대 방향·엔티티 순서를 바꿔도 0.001 안에서 대칭, 등 뒤가 벽이면 정확히 0, `force`로 계속 밀리는 공은 캐릭터를 벽까지 데려가고 0.02 넘게 파고들지 않는다, 머리 위 상자는 바닥에 선 캐릭터를 내리지 못한다, 밀리는 도중 저장한 상태가 정확히 이어진다).
- `node scripts/hashes.ts --check` → 18개 일치, 바뀐 해시 없음(`tumble3d` 포함).
- `node scripts/images.ts` → 이 PC에서는 참고 출력뿐(0 failed). 그리기 코드는 건드리지 않았다.
- CI: 커밋 653801a에서 `ci`(Linux·macOS·Windows, 고정 해시 `ee3ca884` 포함)와 `images` 초록. `demo`는 배포 단계가 한 번 실패했다("Fetching artifact metadata failed", GitHub 쪽 오류로 보이고 원인은 확인하지 않았다). 실패한 작업만 다시 돌리자 초록이 됐다.

## 검증 (2026-11-26 6차, 이전 기록: 가이드 층 분리, 스크립트가 강체를 옮긴다)

- `npm test` → 109개 통과(이 PC, 건너뜀 0). 6차에서 2개가 늘었다: 스크립트가 강체의 위치·속도·회전·각속도를 쓰는 것(쓴 값이 다음 틱에 반영, 길이가 1이 아닌 사원수는 방향만 취함, 읽기만 하거나 같은 값을 다시 쓰면 해시가 그대로), 캐릭터 0.03 앞에 놓인 강체가 그 틱에 캐릭터를 막고 저장한 상태가 그 과정을 정확히 이어 감. 가이드 테스트는 "모든 컴포넌트가 핵심 또는 주제 가이드에 설명돼 있고 핵심에 이름이 있다"로 바꿨고, MCP 테스트에 `topic` 호출을 넣었다.
- `node scripts/hashes.ts --check` → 18개 일치, 바뀐 해시 없음. 고정 강체 해시(b390abd2)도 그대로다.
- `node scripts/images.ts` → 이 PC에서는 참고 출력뿐(0 failed). 그리기 코드는 건드리지 않았다.
- CI: 커밋 f88182c(가이드)와 1f486cc(강체 옮기기) 모두 `ci`(Linux·macOS·Windows), `images`, `demo` 초록.
- PowerShell에서 `gh ... -q '.[] | "\(.x)"'`는 따옴표가 깨진다. `--json ... | ConvertFrom-Json`으로 읽는다.

## 검증 (2026-11-26 5차, 이전 기록: 강체가 캐릭터를 막는다)

- `npm test` → 107개 통과(이 PC, 건너뜀 0). 5차에서 8개가 늘었다: `impulse`·`force`(씬에 적은 것, 스크립트가 붙인 것) 2개와 다음 6개 — 강체가 캐릭터를 막음(가벼운 것은 밀리고 밀도 256짜리는 안 밀림), 벽에 낀 강체(상자·공)가 벽과 캐릭터 어느 쪽에도 겹치지 않음, 강체 위에 착지·서기·`ride`·점프, 첫 틱부터 막음 + 틱당 4유닛 공이 0.2 두께 벽을 통과하지 않음, `push` 상자가 강체 앞에서 멈춤, 미는 도중 저장한 상태가 정확히 이어짐.
- 각 장치를 빼고 테스트가 실패하는지 확인했다(이 PC, 수동): 새 강체 개별 질의를 빼면 "첫 틱" 테스트가, 소프트 CCD를 빼면 "밀기"·"벽에 낌"·고정 해시가, 스킨을 0으로 하면 "벽에 낌"이, 스윕 호출을 빼면 새 테스트 5개가 실패한다. **얇은 벽 테스트는 소프트 CCD 유무와 무관하게 통과한다**(Rapier가 원래 틱당 0.5~4유닛 공을 0.2 벽에서 막았다. 공 하나·벽 하나, 8개 위치, 반발 0과 0.5로만 쟀다).
- `node scripts/hashes.ts --check` → 18개 일치. `tumble3d`만 의도적으로 바뀌었다(74f10147 → 14a9b8c2). 테스트의 고정 강체 해시도 소프트 CCD 때문에 바뀌었다(9ef98050 → b390abd2). 나머지 17개 예제 해시는 그대로다.
- `solve`는 바뀐 `tumble3d`를 897개 상태로 푼다. 예제의 기존 입력 파일도 그대로 통과한다.
- CI(커밋 095d669): `ci`(Linux·macOS·Windows), `images`, `demo` 모두 초록. `tumble3d@70.webgpu.png` 기준은 01d87ab의 `images` 아티팩트로 바꿨고 다음 실행에서 차이 0.000%였다. 01d87ab의 `demo`는 GitHub Pages 쪽 오류(아티팩트 메타데이터 조회 실패)로 한 번 실패했고 다음 push에서 통과했다.
- 수치(이 PC, `tumble3d`에서 오른쪽 키를 200틱 누름): 캐릭터와 공 사이 최소 간격 0.0067(스킨 0.0078), 벽에 닿은 공의 끝 14.0000(벽 14). 스킨·소프트 CCD를 넣기 전에는 공이 벽에 0.008, 캐릭터가 공에 0.031 겹친 채 멈췄다.

## 검증 (2026-11-26 4차, 이전 기록)

- 아래 수치는 4차 시점의 것이다. 테스트 수와 `tumble3d` 해시는 위 5차 값이 최신이다.

- `npm test` → 99개 통과(이 PC, 건너뜀 0). 이번 세션에서 22개가 늘었다(77 → 99): 회전 5개(브라우저 1개 포함), glTF 8개(브라우저 1개 포함), 물리 8개, 빌드 폴더를 브라우저로 여는 것 1개.
- `node scripts/hashes.ts --check` → 예제 18개 해시 일치. 기존 14개의 해시는 이번 세션 전과 같다.
- CI `ci`(Linux·macOS·Windows): 물리 커밋(be19b70)에서 Windows·macOS 98개 통과, Linux 97개 통과에 1개 건너뜀(WebGPU 캔버스 항목). 세 OS에서 강체 예제 `tumble3d`의 해시(74f10147)와 테스트에 고정한 강체 해시가 같았다. 회전 예제의 각도·사원수 해시도 같다.
- `images` 워크플로(Linux, SwiftShader): 기존 11장면은 회전·glTF·물리 변경 뒤에도 기준과의 차이가 그대로다(2D·WebGL2 0.000%, WebGPU 0.174%, 0.225%). 즉 PBR 경로를 넣은 셰이더 변경이 상자·OBJ 그림을 바꾸지 않았다. 새 기준: `windmill@100.png`(2D), `orrery3d@100.webgpu.png`, `gallery3d@10.webgpu.png`, `tumble3d@70.webgpu.png`(셋은 WebGPU 전용).
- 내보낸 정적 폴더: 하위 경로의 평범한 정적 서버에서 `tumble3d`(물리)와 `gallery3d`(glTF)가 헤드리스와 같은 해시로 돌고 페이지 오류가 없다(브라우저 테스트). 공개 Pages 데모(`?scene=tumble3d.kiln`)를 앱 내 브라우저로 한 번 열어 WebGPU 3D로 그려지고 강체가 떨어져 멈추는 것을 봤다(자동 검사 아님).
- 물리: 브라우저(Chrome, 이 PC)에서 재생한 강체 예제의 해시가 헤드리스와 같다(백엔드의 정확한 상태 포함). 저장한 상태에서 이어 간 실행이 끊지 않은 실행과 같은 해시로 끝난다. `solve`는 `tumble3d`를 902개 상태, 2초 안에 풀고, 스냅샷 캐시를 1바이트로 줄여도(전부 재시뮬레이션) 같은 답을 낸다.
- 회전 정밀도: 90°/s로 4초(한 바퀴) 돌린 사원수가 항등에서 7단위(1/65536 기준) 벗어난다. 100바퀴에서 32단위. 테스트가 1초 뒤의 정수 값 자체를 고정한다.
- glTF: 직접 만든 세 파일만 읽었다. 삼각형 방향과 법선의 일치는 테스트가 전 삼각형에 대해 확인한다.
- 사전 시험(`spikes/RESULTS.md`): 헤드리스 WebGPU 8개 조합 중 7개 통과. Rapier 결정론 빌드는 Windows x64, Linux x64, macOS arm64에서 상태 해시와 스냅샷 바이트가 같았다. 각 1회 실행.
- 이전 세션의 측정값(`solve` 상태 수, 속도, Godot 크기 비교)은 `bench/`와 README에 있다. 이번에 다시 재지 않았다.

## 알려진 한계

렌더링

- **Linux의 소프트웨어 렌더링에서는 WebGPU 캔버스 표시가 장치를 잃는다**(빈 화면). 텍스처로 그려 읽는 것은 된다. 그래서 `look`과 검사는 항상 오프스크린으로 그리고, 캔버스 경로 테스트는 Linux에서 건너뛴다. GPU가 있는 Linux에서는 확인하지 않았다.
- WebGPU가 시작은 됐는데 그리다 실패하면 WebGL2로 넘어가지 않는다(캔버스는 처음 준 컨텍스트 종류를 유지한다). 그 경우 `?renderer=webgl2`로 열어야 한다.
- 회전은 그리기에만 쓰인다. 충돌·트리거·`solve`는 돌리지 않은 상자를 본다. 부모-자식 변환(계층)이 없다. ASCII 뷰(`--view`)는 회전을 그리지 않는다. 2D에서는 z축 회전만 보인다.
- glTF: 정적 모델만. 애니메이션, 스킨, 모프, 카메라, 확장(KHR_*), 두 번째 UV, sparse 접근자, BLEND 투명은 읽지 않고 경고한다(`check`의 K315, 플레이어 콘솔). 모델은 엔티티 상자에 축별로 늘려 맞추므로 상자 비율이 모델과 다르면 찌그러진다. 한 머티리얼의 텍스처들은 첫 텍스처의 샘플러를 같이 쓴다. 정점은 인덱스 없이 풀어서 올린다.
- **다른 도구가 내보낸 glTF는 한 번도 읽어 보지 않았다.** 예제 모델은 이 저장소의 생성기(`scripts/models.ts`)가 쓴 파일이라, 쓰는 쪽과 읽는 쪽이 같은 오해를 하고 있으면 테스트가 잡지 못한다. Blender·Khronos 샘플로 확인이 필요하다.
- PBR은 태양 하나와 고정된 하늘/땅 주변광이다. 환경 맵(IBL)이 없어서 금속은 가짜 하늘색을 비춘다. 톤 매핑은 1에서 자르기뿐이다. 그림자 패스는 알파 마스크를 무시한다. 광원은 여전히 태양 하나다. 3D 화면에는 이미지·글리프·라벨이 없다.
- 그림이 맞는지는 내가 PNG를 눈으로 본 것과 기준 이미지 비교뿐이다. 다른 렌더러(Blender, three.js)와 같은 모델을 비교하지 않았다.
- WebGL2는 회전과 glTF를 그리지 않으므로 `orrery3d`, `gallery3d`는 WebGPU 전용 기준 이미지를 쓴다. 나머지 3D 장면은 WebGL2가 그린 기준을 두 렌더러가 같이 쓴다.
- Firefox, Safari, 외장 GPU에서는 아무것도 확인하지 않았다. 해시 일치도 V8에서만 확인했다.
- 효과음은 호출 횟수만 검사한다. 소리를 들은 사람이 없다. 터치는 합성 이벤트만 검사했고 실제 휴대폰에서 해 보지 않았다. 사람이 키보드로 플레이한 확인도 없다.

물리 백엔드

- 강체는 상자와 공뿐이다. 조인트, 캡슐·볼록 다면체·메시 충돌이 없다. 빠른 물체는 소프트 CCD(예측 거리 1유닛)만 켰고 정식 CCD는 켜지 않았다.
- 강체가 캐릭터를 민다(7차). 한계: **한 번 부딪힌 것으로는 조금만 밀린다**(질량 2.6, 속도 2.9인 공이 질량 2인 캐릭터를 0.05유닛). 밀린 속도를 다음 틱으로 가져가지 않기 때문이다(캐릭터가 매 틱 발을 다시 딛는 셈). 계속 힘을 받는 강체는 캐릭터를 데려가지만 느리다(힘 40, 질량 2.6인 공이 초당 0.26유닛). 이 수치가 게임에서 쓸 만한지는 사람이 해 보지 않았다. 접촉 법선 충격량만 읽으므로 마찰로 끌려가지는 않는다. 캐릭터가 선 강체가 꺼지면 다음 틱에 따라 내려갈 뿐인 것은 그대로다. 공중에 뜬 캐릭터의 머리에 강체가 얹히면 가짜 등속 하강이 더해질 것이다(시험하지 않았다). 여러 강체가 한 캐릭터를 동시에 밀면 키 순서로 하나씩 처리한다(시험하지 않았다). 밀려난 캐릭터는 틱 시작 때 만든 고체 색인으로 막히므로, 그 틱에 움직인 발판의 새 자리는 모른다.
- 캐릭터가 강체를 미는 힘은 틱마다 주는 "진흙 충돌" 충격량이다(닫히는 속도 × M·m/(M+m), 질량 중심으로). 캐릭터 질량은 상자 부피(밀도 1)로 고정이고 씬에서 바꿀 문법이 없다. 서 있을 때 강체가 받는 무게는 이 식의 근사라 실제 무게와 다르다. 밀 때 회전력은 주지 않는다.
- 스윕은 캐릭터의 돌리지 않은 상자를 축별로 던진다. 캐릭터는 강체에서 1/128유닛 떨어져 멈춘다(스킨). 비스듬한 면을 타고 오르거나 계단을 넘는 처리는 없다.
- `solid`+`vel` 발판은 스윕하지 않으므로 여전히 무한한 힘으로 강체를 밀고 벽에 끼울 수 있다. `body` 없이 `vel`만 가진 상자는 강체에 닿으면 벽에 닿은 것처럼 그 축 속도가 0이 되어 선다(한 번 툭 치고 멈춘다).
- 여러 강체를 줄지어 벽에 대고 계속 밀면(캐릭터→상자→공→벽) 가운데 강체가 돌거나 옆으로 빠진다. 3초 실행에서 공이 벽에 0.005 들어간 것을 봤다(테스트 없음).
- 물리 장면을 실행 도중 텍스트로 저장했다가 읽으면 끊지 않은 실행과 달라진다(테스트가 이 차이를 확인한다). 정확히 이어 가려면 `saveLink`/`restoreLink`를 써야 한다.
- 스크립트가 `rigid` 엔티티의 `pos`·`vel`·`quat`를 고치면 강체가 따라간다(6차). 방식: `physicsSync`가 틱마다 백엔드 값을 읽어 반올림한 것과 거울 컴포넌트를 비교하고, 다른 묶음(위치/회전/속도/각속도)만 `BackendWorld.place`로 넘긴다. 안 고친 묶음은 float 값을 그대로 유지한다. 그래서 **누가 썼든** 거울이 바뀌면 강체가 움직인다: `rigid`에 `ctrl`·`pace`를 같이 붙이면 그 속도가 강체에 들어갈 텐데 이 조합은 시험하지 않았다. 코어 중력은 `rigid`+`body`에 더하지 않게 막았다. `box` 크기를 실행 중에 바꾸는 것은 여전히 반영되지 않는다. `impulse`·`force`는 질량 중심으로만 작용한다(회전력 없음. 각속도를 직접 쓰는 것은 된다).
- 위치를 옮긴 강체는 Rapier 장면 질의가 다음 스텝까지 못 보므로(직접 확인: 옛 자리도 새 자리도 안 맞는다), 어댑터가 `propagateModifiedBodyPositionsToColliders`로 충돌체를 옮기고 "새 강체" 집합에 넣어 개별로 묻는다. 둘 중 하나라도 빼면 "그 틱에 막음" 테스트가 실패한다(이 PC에서 확인).
- 틱당 `read`는 강체마다 한 번이다(8차에서 비교용 읽기를 없앴다). 1,000개에서 약 1.3ms(타이머 포함 상한)로 Kiln 쪽 비용의 가장 큰 항목이다. 읽기 한 번이 WASM 호출 4번과 객체 4개라서, 더 줄이려면 어댑터가 여러 강체를 한 번에 읽는 길을 내야 한다(하지 않았다).
- 가이드는 층으로 나눴다(6차): 핵심 가이드(5,223자, 예산 5,600) + `guide physics`·`guide view`(각 예산 2,500). 컴포넌트는 `defineComponent`의 마지막 인자로 주제에 들어간다. 주제에 든 컴포넌트는 핵심 가이드에 이름만 나온다. **에이전트가 주제 가이드를 실제로 찾아 읽는지는 확인하지 않았다**(다음 일 5번에서 볼 것). 스크립트가 정의한 컴포넌트는 주제를 가질 수 없고 핵심에 들어간다.
- 2D 강체는 없다(백엔드는 3D이고, 2D 장면에서 z로 넘어가는 것을 막는 잠금이 없다).
- 트리거는 강체도 돌리지 않은 상자로 본다.
- 규모(8차 측정, `bench/PHYSICS.md`): 기준 노트북에서 60Hz에 드는 강체는 500개 근처까지다. 점수판 목표(10,000개)와 20배 차이가 나고, 시간의 70~80%가 결정론 WASM 솔버(단일 스레드, SIMD 없음)라 Kiln 쪽을 줄여서는 닿지 않는다. 잠든 강체가 많은 장면, 캐릭터가 수십 명인 장면, 수백 개 장면에서의 `solve`(스냅샷 크기와 저장·복원 시간만 쟀고 탐색은 돌리지 않았다)는 재지 않았다. 측정은 한 대, 한 번이다. 기능 테스트는 여전히 강체 24개 이하의 장면이다.
- 백엔드 월드는 WASM 메모리라 가비지 수집되지 않는다. `run`이 돌려준 월드는 `freeLink`를 부르지 않으면 프로세스가 끝날 때까지 남는다.

시뮬레이션

- 충돌은 축 정렬 상자뿐이다(회전해도 그대로). 트리거는 틱마다 겹침만 봐서 아주 빠른 물체는 건너뛸 수 있고, 전수 비교(트리거 수 × 대상 수)다.
- 움직이는 고체는 위에 선 `body`를 태우고 들어 올리지만 옆의 것을 밀지 않고 벽을 통과한다.
- `push`는 한 번에 하나만 밀고, 상자는 중력을 받지 않는다.
- `solve`는 조작 캐릭터 하나와 작은 레벨에서만 확인했다. 휴리스틱이 벽을 모르는 직선 거리라 깊은 미로에서 상태 한도(20만)에 걸릴 수 있다. 가장 짧은 입력을 보장하지 않는다. `at` 조건은 탐색하지 않는다.
- 스크립트가 컴포넌트 밖(클로저 변수)에 상태를 두면 탐색이 틀어진다. 비결정 검사는 줄 단위 정규식이라 뻔한 것만 잡는다.
- 컴포넌트 레지스트리가 프로세스 전역이다.

에디션

- 판정은 장면 글의 틱 0 상태만 본다. 스크립트가 실행 중에 붙이는 컴포넌트(`rigid`, `quat`)는 세지 않는다. 스크립트가 정의한 컴포넌트도 축을 적을 수 있지만 시험하지 않았다.
- `--edition`은 `check`에만 있다. `test`·`run`·`solve`·`build`는 상한을 모른다.
- "낮은 에디션의 게임이 높은 에디션에서 같은 해시"는 빌드에서 부품을 뺀 두 장면으로만 확인했다. 예제 전부를 에디션별로 재생하는 검사는 없다(게임을 특정 에디션으로 돌리는 스위치 자체가 없어서, 지금은 부품 유무가 전부다).
- `build`의 `3d` 판정은 글자 맞추기다(장면의 `eye` 줄, 스크립트의 따옴표 친 `eye`). 이름을 계산해서 붙이는 스크립트는 놓치고, 그 경우 게임은 2D로 그려지며 페이지 콘솔에 오류가 난다. 주석 속 `'eye'`는 쓸데없이 렌더러를 싣게 한다.
- 3D Lite 게임은 두 렌더러를 다 싣는다(WebGPU가 있으면 그것을 쓰므로). WebGL2만 싣는 더 작은 빌드는 만들지 않았다.
- 예산은 바이트뿐이다. 메모리, 첫 화면까지 시간, 틱당 할당은 재지 않았다. 바이트도 압축 전 값이고 실제 전송량(gzip)은 재지 않았다.
- 부품을 나중에 읽게 바꾼 뒤 `play`·`look`·기준 이미지가 그대로인 것은 이 PC의 Chrome 테스트와 `scripts/images.ts`로만 봤다. 느린 네트워크에서 렌더러가 늦게 오는 동안의 화면(2D 뷰가 잠깐 보인다)은 예전에도 WebGPU 시작 동안 그랬고, 길어졌는지는 재지 않았다.

도구

- `use` 스크립트는 임의 코드이고 샌드박스가 없다(README Safety 절).
- `look`은 Chrome이나 Edge가 설치돼 있어야 한다.
- MCP 서버는 JSON-RPC 테스트로만 확인했다. 실제 Claude Code 클라이언트에 연결한 적이 없다.
- `load:FILE`은 대상 파일이 있는지 검사하지 않고, 레벨 사이에 상태를 넘기지 않는다.
- Godot 크기 비교는 게임 하나, 실행해 보지 않은 Godot 파일, 문자 수로 추정한 토큰이다. UE5와의 비교는 아직 하나도 없다.
- 2c600d7 커밋의 `bench/PERF.md`에 측정 PC의 CPU 모델명이 들어갔다. 다음 커밋에서 뺐지만 이력에는 남아 있다.

## 물리 백엔드 설계 (2026-11-26, 구현 전에 정했고 그대로 구현했다)

근거: `spikes/RESULTS.md`(Rapier 0.21.0 결정론 빌드가 세 OS에서 같은 상태·같은 스냅샷 바이트, 스냅샷 복원이 정확).

- **의존성 위치**: `backends/rapier/`에 자체 `package.json`과 lockfile(0.21.0 고정). 코어(`src/`)는 정적으로 import하지 않고 `loadBackend('rapier')`가 동적으로 읽는다. 설치돼 있지 않으면 오류 코드와 설치 방법을 낸다. 브라우저는 같은 모듈 파일을 import map으로 읽는다.
- **인터페이스**(`src/physics.ts`): 백엔드는 강체 수준만 안다(`addBody`, `removeBody`, `moveKinematic`, `step`, `read`, `hash`, `save`, `free`, 백엔드의 `create`·`restore`). 엔티티↔강체 대응, 고정소수점 변환, 틱 순서는 코어의 동기화 계층이 맡는다. 그래서 다른 엔진(Jolt)을 붙일 때 씬 문법이 바뀌지 않는다.
- **씬 문법**: `world ... physics=rapier`, 컴포넌트 `rigid [shape=box|ball] [density] [bounce] [friction]`. `rigid`+`pos`+`box`가 동적 강체다. `solid`와 solid 타일은 고정 충돌체, `box`+`vel`을 가진 나머지(조작 캐릭터, 움직이는 발판, 밀리는 상자)는 키네마틱 강체로 자동 등록된다. 2단계(5차)부터 강체가 캐릭터를 막는다: 아래 "캐릭터와 강체" 항목.
- **틱 순서**: 입력 → ctrl → pace → 스크립트 pre → 중력 → **강체 등록**(`physicsSync`) → 이동(`rigid` 제외, 축마다 `physicsSweep`으로 강체까지의 거리를 묻는다) → **물리**(키네마틱 목표 위치 전달 → 백엔드 1스텝 → 강체의 pos·quat·vel·각속도를 고정소수점으로 반올림해 컴포넌트에 기록) → 회전(`rigid` 제외) → 트리거 → 스크립트 post.
- **상태와 해시**: 강체의 정확한 상태는 백엔드(float32)가 갖고, 컴포넌트는 반올림한 거울이다. `hash`는 씬 텍스트 해시에 백엔드의 정확한 상태 해시(모든 강체의 위치·회전·속도 비트)를 섞는다. float는 백엔드 안과 이 경계 변환에만 있다.
- **`solve` 결합**: 탐색 노드는 지금처럼 복제한 월드(컴포넌트)와 부모 포인터·키를 갖는다. 백엔드 상태는 노드마다 들고 있지 않고, 바이트 예산이 있는 LRU 캐시에 스냅샷으로 둔다(루트는 고정). 노드를 펼칠 때 스냅샷이 캐시에 있으면 복원하고, 없으면 스냅샷이 남아 있는 가장 가까운 조상에서 복원해 **입력 경로를 다시 시뮬레이션**한다(복원이 정확하므로 같은 상태가 된다). 상태 병합 키는 거울 컴포넌트를 1/64 단위로 깎은 값이라 그대로 쓴다. 답은 지금처럼 처음부터 재생해 검증한 뒤 보고한다.
- **이 설계가 포기하는 것**: 물리 장면을 실행 도중 텍스트로 저장했다가 읽으면 반올림된 거울에서 솔버가 차갑게 다시 시작하므로, 끊지 않은 실행과 달라진다. (스크립트가 `rigid`의 컴포넌트를 고치면 덮어쓰던 것은 6차에서 없앴다.)
- **강체가 캐릭터를 밀기(7차, 구현했다)**: 백엔드 스텝 직후, 거울을 쓰기 전에 한다(거울을 쓴 뒤에 강체에 충격량을 주면 다음 틱 `physicsSync`가 "스크립트가 속도를 고쳤다"로 읽어 되돌린다).
  - `BackendWorld.touching(key)`가 키네마틱 강체에 닿은 동적 강체마다 접촉 법선 충격량 합 J(캐릭터가 받은 방향)를 돌려준다. Rapier에서는 `contactPairsWith`로 상대를 모은 뒤 `contactPair`의 매니폴드에서 `normal()`×`contactImpulse(i)`를 더한다(콜백 안에서 다시 질의하지 않는다). 부호는 `flipped`로 정한다.
  - 대상은 `solid`가 아니고 `vel`이 있는 키네마틱(스윕으로 움직이는 것들). 캐릭터 질량 M은 상자 부피, 강체 질량 m. 축마다 J/(M+m)/hz 만큼 `nudge`(sim.ts, 고체·타일·다른 강체 앞에서 멈춤)로 옮기고, 실제로 간 비율만큼만 J·m/(M+m)를 강체에 돌려준다. 못 움직이면(벽, 바닥) 아무것도 돌려주지 않아 예전 동작과 같다.
  - 직접 확인한 것(Rapier 0.21.0, 이 PC): 접촉 충격량은 강체가 잃은 운동량과 같다(J = m·Δv). 캐릭터가 스킨 간격으로 강체를 밀고 있을 때는 0이라 미는 쪽 계산과 겹치지 않는다. 얹힌 상자는 틱마다 m·g·dt다. 충격량은 스냅샷 복원 뒤에도 그대로 읽힌다. 세 OS에서 값이 같은지는 새 테스트의 고정 해시(`ee3ca884`, 무거운 공 장면 240틱)가 CI 세 OS에서 본다.
  - `physicsSweep`은 `pace`가 0이면 강체를 치지 않는다(밀려나는 캐릭터가 제3의 강체를 때리지 않게). 기존 호출은 `pace`가 0인 적이 없어 동작이 같다.
- **캐릭터와 강체(5차)**: 고정소수점 스윕은 그대로 두고, 축마다 백엔드에 "이 상자가 이 방향으로 동적 강체에 닿기 전까지 얼마나 갈 수 있나"를 묻는다(`BackendWorld.cast`, Rapier의 shape cast). 답(float)은 내림해 고정소수점으로 바꾸고 스킨을 뺀다. 막히면 그 축 속도를 0으로 하고(벽과 같은 규칙) 강체에 충격량을 준다(`push`, `mass`). Rapier의 자체 캐릭터 컨트롤러를 쓰지 않은 이유: 캐릭터 위치가 float가 되어 고정소수점 코어(스윕, `push` 상자, `solve` 키)와 두 벌이 된다. Rapier의 장면 질의는 스텝이 한 번 돈 뒤에야 강체를 보므로(직접 확인), 어댑터가 "마지막 스텝 뒤에 추가된 강체"를 따로 들고 개별로 묻는다. 그 집합은 스냅샷에 같이 저장한다. 강체가 벽을 한 틱 파고들었다 튕겨 나오는 동안 캐릭터가 따라 들어가 끼는 문제는 소프트 CCD와 스킨 둘로 막았다.
- **구현하면서 정한 것**: 반발 계수는 닿은 둘 중 큰 값을 쓴다(`bounce=0.8`이 바닥 재질과 무관하게 뜻대로 튀도록). 공은 상자의 `w/2`를 반지름으로 쓴다. 강체의 `vel`·`quat`가 없으면 첫 틱에 자동으로 붙는다. 키네마틱·고정 충돌체는 회전을 무시한다(상자 코어와 같은 규칙).

## 다음 일

순서대로 한다. 각 덩어리는 검사와 함께 끝낸다.

**2026-11-26 에디션 결정으로 순서를 바꿨다.** 아래 번호 목록(1~7)은 그대로 두되 다음 순서로 집는다. 근거는 `docs/EDITIONS.md`의 "Order of work"다.

- A. ~~에디션 선을 코드에 긋는다~~ 끝(9차): 축별 판정, `--edition` 상한, `build` 부품 선별, 바이트 예산. 남은 것: "예제 전부를 에디션별로 재생해 같은 해시"는 두 장면으로만 했다(점수판에 works로 적었다). 메모리·첫 화면 시간·틱당 할당 예산은 C에서 한다. B는 10차에 첫 실행을 했다.
- B. ~~첫 실행~~ 끝(10차, `proof/lite/RUN.md`). **다음에 집을 일은 B의 남은 것, 중요한 순서로**: ~~(a) `solve` 문제 둘~~ 끝(11차), ~~(b) 헤드리스 `load`와 한 장면 여러 검사~~ 끝(12차), ~~(c) Lite 증명 게임 60fps 측정~~ PC에서 끝(13차, 휴대폰은 C에서), ~~(d) 같은 명세를 Godot+에이전트로~~ ~~(e) 고친 뒤 다시 실행해 비교~~ 끝(14차, 각 1회). **B는 끝났다. 다음은 C.** 여유가 되면 세 조건을 2~3회씩 더 돌려 편차를 잰다(한 번에 Sonnet $0.4~0.7). 원래 문구: **5번(실제 에이전트 연결)을 앞으로 당긴다.** 세 에디션이 전부 이 위에 서는데 한 번도 해 보지 않았다. Lite 증명 게임의 명세를 먼저 쓰고, 에이전트가 끝까지 만들게 하고, 에이전트 비용(토큰, 시간, 사람 없이 고친 실패 수)을 기록한다.
- C. **Lite 게이트를 닫는다**: 4번(2D 표현력) + 오디오·UI·게임패드·레벨 간 상태 + 남은 예산(메모리, 첫 화면 시간, 틱당 할당 0) + 실제 휴대폰에서 한 번 실행(Unity가 기준인 행). 한 덩어리에 한 행씩 한다.
  - ~~타일 문자별 색·이미지, `#` 경고~~ 끝(15차).
  - ~~`build`가 싣는 바이트 줄이기~~ ~~스프라이트 애니메이션~~ 끝(16차).
  - ~~레벨 간 상태~~ 끝(17차).
  - ~~게임패드~~ 끝(18차). ~~오디오~~ 끝(19차). ~~UI~~ 끝(20차).
  - **다음에 집을 일, 순서대로**(2D Lite 엔진은 67,497 / 72,000바이트다. 코어 가이드는 한도까지 10자쯤 남았으니 설명은 주제 가이드에 넣고, 새 주제를 만들면 코어의 주제 줄만큼 다른 곳을 줄여야 한다): (7) 남은 예산(메모리, 첫 화면까지 시간, 틱당 할당 0).
  - (16차에 구현했다. 아래는 그때의 설계안이고, 달라진 점은 16차 검증 절에 있다.) 스프라이트 애니메이션은 설계만 해 두었다(구현 0줄, 내 안): `anim FRAMES [fps=8] [idle=0]` 구성요소를 `view` 주제에 둔다. `sprite image`가 가로로 FRAMES칸인 시트다. 프레임은 `floor(tick*fps/hz)`로 틱에서만 정한다(상태 없음, 재생하면 같은 그림). `idle=N`이면 앞의 N칸은 서 있을 때, 나머지는 움직일 때 돈다. 왼쪽을 볼 때 뒤집기는 "마지막으로 본 방향"이 필요한데, 플레이어 변수로 두면 저장·복원에서 사라지므로 구성요소 필드(`face`, 시뮬레이션이 `vel.x` 부호로 갱신, 해시에 들어감)로 둔다. 검사는 프레임마다 단색인 시트를 그려 여러 틱에서 엔티티 중심 픽셀 색이 기대한 프레임인지 보는 브라우저 테스트 + 기준 이미지 한 장.
  - **(7)의 시작점(20차 세션 끝에 재기만 했다. 고친 것 없음)**:
    - **틱당 할당**: `bench/alloc.ts`가 잰다(`node --min-semi-space-size=64 --max-semi-space-size=64 bench/alloc.ts examples/maze.kiln ...`. 젊은 세대를 64MB로 고정해 구간 안에서 수거가 안 일어나게 하고 `heapUsed` 차이를 본다. 두 번 돌려 ±2바이트로 같았다. `--min-`을 빼면 음수가 나온다). **첫 수치(이 PC, 틱당 바이트, 입력 재생 / 입력이 끝난 뒤 가만히)**: maze 9,810 / 8,115, platformer 11,135 / 10,604, level1 6,519 / 4,986, dungeon 7,294 / 4,738. 즉 아무 일도 없는 틱도 5~10KB를 할당한다. 목표는 0이다.
    - **어디서 나오나(`src/sim.ts`의 `step`을 읽고 적은 것, 재서 나눈 것은 아니다)**: `w.query()`가 틱당 12번쯤 불리고 매번 배열·나머지 인자 배열·클로저·정렬 / `buildIndex`가 틱마다 고체 전부의 `Block` 배열·`Map`·`Int32Array`를 새로 만든다 / 움직이는 것마다 `cur`·`d`·`size`·`lo`·`hi` 배열과 `blockers`의 결과 배열(닿는 고체 타일마다 `Block` 하나) / 트리거×대상마다 겹침 키 문자열(`이름:이름`)을 틱마다 만든다 / `w.match('#tag')`가 매번 `query('tag').filter` / `w.met = []`, `doomed`, `fresh`, 클로저(`on`, `stop`, `act`, `tagOf`).
    - **내 안(구현 0줄)**: (가) `World.query` 결과를 구성요소 집합별로 캐시하고 `add`·`drop`·`spawn`·`despawn` 때 버전을 올려 무효화한다(스크립트가 받은 배열을 고치면 안 되므로 가이드에 한 줄 필요, 또는 스크립트용은 복사). (나) 고체 색인은 고체가 움직이지 않은 틱에는 다시 만들지 않는다(움직이는 고체·상자는 지금도 `big`에 따로 있다). (다) 이동 루프의 작은 배열은 모듈 수준 임시 배열로. `blockers`는 호출자가 준 배열에 채운다. 타일 `Block`은 재사용 풀. (라) 겹침 키는 저장 형식(이름 문자열)은 그대로 두고 실행 중에는 `t * 2^21 + o` 숫자 키를 쓰거나, 겹침이 시작·끝날 때만 문자열을 만든다. (마) 해시(`examples/HASHES`)가 한 줄도 안 바뀌어야 한다 — 이 작업의 검사다. (바) 끝나면 `tests/`에 `bench/alloc.ts`를 자식 프로세스로 돌려 "가만히 있는 틱 N바이트 이하"를 지키는 테스트를 넣는다(CI 세 OS에서 수치가 같은지 먼저 본다. 다르면 넉넉한 상한으로). `use` 스크립트가 있는 장면(증명 게임)은 `bench/alloc.ts`가 아직 못 돌린다(`loadMods`를 붙여야 한다).
    - **메모리·첫 화면까지 시간**: 재지 않았다. 내 안: `bench/frames.ts`처럼 `src/chrome.ts`로 증명 게임 빌드를 열고, DevTools `Performance.getMetrics`의 `JSHeapUsedSize`(로드 뒤 강제 GC 후)와 탐색 시작부터 첫 `draw`까지의 시간을 여러 번 재 `proof/lite/`에 기록한다. `docs/EDITIONS.md` 표대로 기준 PC에서만 재고 CI에서는 강제하지 않는다(흔들린다). 점수판 줄 48·51이 대상이다.
  - 실제 휴대폰 측정은 사용자 기기가 필요해 남겨 둔다(Lite 기준 휴대폰도 정해지지 않았다).
- D. **Standard 게이트**: 2번과 3번의 남은 것(다른 도구의 glTF, 애니메이션·스킨, 조명, 모양·조인트. 수백 개 규모 측정은 8차에 끝), 내비게이션, 네트워크, 엔티티 10만 개 틱 시간(Unity DOTS가 기준), 데스크톱 실행 파일, 증명 게임과 에이전트 비용.
- E. **Ultra**: 네이티브 런타임이 필요한지 재는 사전 시험부터. 7번(기존 엔진 분석)은 C~E의 각 단계에 들어갈 때 해당 부분을 한다.

정하지 않은 것(사용자에게 물을 것): 에디션별 증명 게임 셋, Ultra 기준 기계(외장 GPU가 있는 기계가 없다), Lite 기준 휴대폰, 라이선스(6번. 에디션이 유료 등급이 아니라는 것과 묶여 있다). 2D 강체는 축으로 풀렸다(그리기 Lite + 물리 Standard인 게임은 딱 그만큼만 싣는다).

알아 둘 충돌: 결정론과 병렬 처리(병렬 시뮬레이션은 직렬과 같은 해시가 나오는 검사가 있어야 받는다), `solve`는 Ultra 규모 장면을 탐색하지 못한다(축소 장면·재생·`expect`·`look`으로 대신한다), 브라우저 WebGPU로는 Ultra 목표가 안 될 수 있다(목표는 줄이지 않고 Standard 게이트 근처에서 측정으로 정한다), Kiln도 JS라 Unity와 같은 GC 문제가 있다(재지 않았다).

1. ~~회전~~ 끝(2026-11-26).
2. ~~glTF 로드와 PBR·텍스처~~ 끝(2026-11-26). 남은 것: 다른 도구가 만든 glTF 검증(Khronos 샘플 중 CC0만, 출처 표기), 환경 맵, 애니메이션·스킨.
3. ~~물리 백엔드~~ 끝(2026-11-26). ~~강체가 캐릭터를 막고 받치기~~ 끝(5차). ~~스크립트·씬에서 힘·충격(`impulse`, `force`)~~ 끝(5차). ~~가이드 예산~~ 끝(6차, 층 분리). ~~스크립트가 강체의 위치·속도·회전을 직접 고치기~~ 끝(6차). ~~강체가 캐릭터를 밀기~~ 끝(7차). ~~수백 개 규모 측정~~ 끝(8차, 500개 근처까지 60Hz). 남은 것, 중요한 순서: 회전력(`impulse`에 작용점), 조인트, 다른 모양. 규모를 더 올리려면 솔버 쪽이 병목이다(Rapier의 SIMD·병렬 빌드는 결정론 빌드가 아니다. 대안은 재 보지 않았다).
4. 2D 표현력: 스프라이트 애니메이션, 타일 문자별 색·이미지, `tiles`의 `#` 경고.
5. 실제 에이전트를 MCP로 연결해 소형 게임을 끝까지 만들고 토큰을 실측한다. 그 뒤 같은 명세로 Godot와 비교한다.
   - Godot 4.7.2 Windows 실행 파일 zip(`Godot_v4.7.2-stable_win64.exe.zip`)이 사용자의 Downloads 폴더에 있다(아직 풀지 않았다). 이것으로 (1) `bench/godot/`의 대응 구현을 `--headless`로 실제 실행해 "실행해 보지 않은 Godot 파일" 한계를 없앨 수 있고, (2) 같은 명세를 Godot와 Kiln으로 만드는 비교 실험에 쓸 수 있다. 쓰기 전에 zip의 SHA-512를 Godot 공식 릴리스의 체크섬과 대조한다.
6. 라이선스 결정(MIT 유지 여부). 외부 기여가 들어오기 전에 사용자가 정해야 한다.
7. 기존 엔진을 뜯어 분석해 개발에 참고한다(사용자 지시, 2026-11-26. 시기는 "나중에"이고 순서는 정하지 않았다). 대상: Godot, Unity, Unreal 등. Unreal은 기준 PC에 설치할 수 있을지 사용자도 모른다.
   - 시작 전에 각 엔진의 소스 라이선스를 직접 읽고 확인한다(아래는 기억에 의존한 것이라 확인이 필요하다). Godot는 MIT라 코드까지 참고할 수 있다. Unity와 Unreal의 소스는 열람용 조건이 붙어 있어, Kiln은 공개 저장소이므로 그쪽 코드를 옮겨 적지 않고 구조·동작·수치만 참고한다.
   - 분석 결과는 `docs/`에 엔진별 문서로 남기고, 참고해서 정한 것은 `docs/PARITY.md` 행에 연결한다.

사용자 몫: 기준 PC에 UE5 설치(언리얼급 비교 때 필요, 지금은 아님). 기준 PC는 Intel 내장 GPU 노트북이라, 언리얼급 지오메트리·조명 목표를 재려면 외장 GPU가 있는 기계가 필요할 수 있다.

## 공개 전환 기록

2026-11-26에 저장소를 공개로 전환했다. 전환 전에 git 이력 전체에서 메일 주소, 사용자 폴더 절대경로, 키·토큰·비밀번호 패턴을 검색했고 해당 항목이 없었다.
