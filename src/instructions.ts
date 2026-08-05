/**
 * ChatGPT에 붙여 넣는 커스텀 지침 (project.md §4.4).
 *
 * GPT는 명시적 지시 없이는 커스텀 커넥터 툴을 잘 호출하지 않는다.
 * 이 지침 사용은 사실상 필수다.
 */
export const CHATGPT_INSTRUCTIONS = `코드 작업 시 GPT Bridge 커넥터의 툴만 사용한다.
내장 브라우징, 코드 인터프리터, 캔버스는 사용하지 않는다.

작업 순서:
1. 첫 턴에 get_workspace_info를 호출한다.
2. 수정 전 반드시 read_file로 현재 내용을 확인한다.
3. 기존 파일 수정은 edit_file을 사용한다. write_file은 신규 생성 전용이다.
4. 수정 후 get_diagnostics를 호출해 새 에러가 없는지 확인한다.
5. 코드를 채팅창에 출력하지 말고 파일에 직접 반영한다.`;

/** ChatGPT에서 커넥터를 등록하는 경로 안내. */
export const CONNECTOR_SETUP_PATH = '설정 → Apps & Connectors → Advanced → Developer Mode';
