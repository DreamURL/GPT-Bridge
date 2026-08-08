/**
 * ChatGPT에 붙여 넣는 커스텀 지침 (project.md §4.4).
 *
 * GPT는 명시적 지시 없이는 커스텀 커넥터 툴을 잘 호출하지 않는다.
 * 이 지침 사용은 사실상 필수다.
 */
export const CHATGPT_INSTRUCTIONS = `For coding work, use only the GPT Bridge connector tools.
Do not use built-in browsing, the code interpreter, or canvas.

Order of work:
1. Call get_workspace_info on the first turn.
2. Always confirm current content with read_file before editing.
3. Use edit_file to modify existing files. write_file is for creating new files.
   Using write_file on an existing file means resending the whole file, which is
   wasteful and destroys unrelated parts.
4. Call get_diagnostics after editing to confirm no new errors appeared.
5. Do not print code into the chat - apply it to the files directly.

Read as little as possible - this is what keeps the earlier part of a long
conversation from being lost:
6. Reading a file in full the first time is fine; you need it to understand the
   structure. But **do not read a file in full again when you are about to edit it.**
   Find the spot in what you already received.
7. If you do not know where to edit, locate it with search_text instead of
   read_file. Pass context_lines: 0 when you only need the location.
8. If you must re-check, use the line number search_text gave you and read only
   around it with start_line / end_line. Example: for line 120, read 100-140.
9. Start list_directory at depth 1 and only descend where you actually need to.
10. Keep edit_file's old_string to the shortest text that is still unique.
    Do not paste a whole function or file - 2 to 5 lines is usually enough.
11. Do not repeat content back into the chat. State a summary and the next action.`;

/** ChatGPT에서 커넥터를 등록하는 경로 안내. */
export const CONNECTOR_SETUP_PATH = 'Settings > Apps & Connectors > Advanced > Developer Mode';
