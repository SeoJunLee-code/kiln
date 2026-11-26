# Kiln

[English](README.md) | 한국어

사람이 아니라 **AI 에이전트가 1급 사용자**인 오픈소스 게임 엔진입니다.

**[브라우저에서 예제 플레이하기](https://seojunlee-code.github.io/kiln/)** — 이 저장소를 `kiln build`로 빌드한 결과입니다. 메뉴에서 장면을 고를 수 있습니다.

기존 게임 엔진은 사람이 에디터 화면을 보는 것을 전제로 합니다. 에이전트가 쓰면 그만큼 비용이 듭니다. 씬 파일이 장황하고, 결과를 화면을 봐야만 확인할 수 있고, 실행할 때마다 결과가 달라집니다. Kiln은 반대로 설계했습니다.

- **전부 텍스트.** 씬은 짧고 diff가 되는 파일입니다. 에디터가 필요 없습니다.
- **결정론 코어.** 고정 틱, 고정소수점 연산, 고정된 시스템 순서. 같은 씬과 입력이면 같은 상태 해시가 나오고, CI가 Linux·macOS·Windows에서 이를 확인합니다.
- **헤드리스 검증.** `kiln test`가 창 없이 씬을 돌려, 씬 안에 쓴 `expect` 줄을 검사합니다.
- **값싼 관측.** 스크린샷 대신 ASCII 그림과 엔티티당 한 줄.
- **기계가 읽는 오류.** 오류마다 코드, `파일:줄`, 수정 힌트가 붙고 한 번에 전부 보고합니다.
- **엔진이 자기 레벨을 직접 플레이.** `kiln solve`가 목표를 만족하는 입력을 탐색해, 아무도 플레이하지 않아도 레벨을 깰 수 있음을 보여 줍니다.
- **MCP 도구 하나.** 에이전트가 MCP로 연결하면 엔진 전체가 도구 하나로 들어옵니다.

![브라우저 플레이어의 3D 예제](docs/arena3d.jpg)

## 현재 수준

만든 지 며칠 된 프로젝트입니다. 장기 목표는 에이전트가 프로토타입부터 출시까지 끌고 갈 수 있는 엔진, 즉 사람 팀에게 언리얼이나 Godot가 하는 역할입니다. 지금은 상자 모양 세계를 위한 작은 코어이고, 2D와 첫 단계의 3D가 됩니다.

| 지금 되는 것 | 아직 안 되는 것 |
|---|---|
| 텍스트 씬, 글자 격자로 그리는 레벨, 프리팹 | 텍스처, 머티리얼, 스켈레탈 애니메이션, 셰이더 |
| x·y·z 고정소수점 시뮬레이션, 스윕 충돌, 트리거 | 회전, 상자 외 충돌 모양, 관절 |
| 실패 이유를 설명하는 `expect` 검사 | 오디오, 애니메이션, UI |
| 결정론 검사가 붙은 TypeScript 스크립트 | 에셋 파이프라인 |
| 브라우저 플레이어(2D, 그림자 있는 3D, OBJ 메시) | WebGPU 렌더러 |
| `solve`, `build`, `new`, MCP 서버 | 네트워킹, 데스크톱·모바일 내보내기 |

사람이 직접 플레이 테스트한 적은 아직 없고, MCP 서버는 자체 테스트로만 확인했습니다. 자세한 상태와 한계는 [HANDOFF.md](HANDOFF.md)에 있습니다.

## 써 보기

Node 24 이상이 필요합니다. 의존성도 빌드 단계도 없습니다.

```
git clone https://github.com/SeoJunLee-code/kiln
cd kiln
npm test
node src/cli.ts solve examples/vault.kiln
node src/cli.ts play examples/platformer.kiln
```

## 에이전트로 게임 시작하기

```
node src/cli.ts new ../mygame
```

시작 씬, 에이전트용 작업 안내(`AGENTS.md`, `CLAUDE.md`), 엔진을 MCP 도구로 연결하는 `.mcp.json`이 만들어집니다. 그 폴더를 Claude Code로 열고 게임을 만들어 달라고 하면 됩니다. 엔진 전체 설명서는 `node src/cli.ts guide` 한 번으로 나옵니다(약 4,500자).

## 씬 예시

```
prefab coin
  box 0.5 0.5
  tag coin
  trigger hero coin despawn-self

entity map
  pos 0 0
  tiles spawn=@:hero,o:coin,D:door
    #########
    #@..#..o#
    #.#.#.#.#
    #o#...#D#
    #########

expect gone #coin by 600
```

## 정말 더 짧은가

측정은 지금까지 하나입니다. 미로 예제(플레이 기록과 검사 포함)가 Kiln으로 729자, 손으로 쓴 Godot 4 대응 구현으로 4,937자입니다. 게임 하나뿐이고, Godot 파일은 Godot에서 실행해 보지 않았으며, 실제 토크나이저로 토큰을 세지 않았습니다. 자세한 내용은 [bench/](bench/README.md)에 있습니다.

## 기여

이슈와 풀 리퀘스트를 환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md)(영문)부터 보세요.

## 라이선스

MIT
