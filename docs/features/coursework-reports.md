# 課業報告 / Coursework reports

「課業」可篩選全部、作業、考試或報告。新增及編輯視窗可選報告，再選發表或繳交；完成、刪除與通知沿用課業操作。E3 作業可手動轉為報告，保留原本的事件 ID、作業連結及同步身分，不會因名稱含「報告」就自動分類。

「考試與報告」的兩個入口一次辨識考試及報告：

- **掃描課綱與公告**：讀取官方週次表與近期公告／信件；有設定 AI 時共用一次抽取呼叫，否則依關鍵字與明確日期產生低信心建議。
- **讀取 syllabus 檔案**：選擇 PDF 或 Word。未啟用 AI 時只在本機解讀 Word；PDF 需要 AI。上傳前顯示所選供應商與檔案確認，Word 只送文字。只有週次的 AI 來源使用已取得的課綱日期對照，沒有日期對照時不猜日期。

所有結果先列為建議。確認時保留報告名稱、組別、來源與日期；發表和繳交各自形成一筆。多組發表日期由使用者選擇自己的組別，不會推定身分。相同課程、名稱、日期且組別相符的既有課業會提示「轉為報告」，保留完成狀態；其他組別、不同報告或不同里程碑不會合併。

發表有可用上課時段時會註明時段推估；繳交不套用上課時間。只有日期時顯示「時間未定」，內部以當日 23:59 排序並依既有通知設定提醒，這不是來源明定的截止時刻。通知分別顯示報告即將開始／截止；日期提醒不顯示 23:59。今日總覽另列今天尚未完成的報告，不需生成 AI 摘要。

來源日期不一致時保留選項。改期先提出更新建議，不直接更改已加入的課業。忽略相同建議後不重複提示，日期改變才重新提示。舊的考試專用抽取快取會在下次掃描失效；舊 syllabus 快取會重新預選供讀取。失敗來源不取代先前建議。

## Data and compatibility

Reports use `kind: 'report'`, `reportType: 'presentation' | 'submission'`, and `reportKey` on confirmed coursework. Suggestions live in `reportSuggestions`; existing `examSuggestions`, exam IDs and assignments without a kind remain compatible. Report IDs include course, normalized literal title, explicit group and milestone type. Accepting reports and exams, local coursework patches, and final assignment sync writes share the background queue.

The Chrome manifest and extension-origin panel load `report-detection.js` after `exam-detection.js`. Safari resource/project integration is tracked separately from this upstream core change.

## Validation

Run `node --test tests/*.test.cjs`, then the existing exam MV3 fixture and `tests/report-extension-smoke.cjs` with Playwright. The report fixture uses an isolated profile, offline sources and fake AI output; it exercises combined scanning, concurrent two-tab acceptance and coursework saves, E3 conversion, report filtering, editing, completion, local Word reading and PDF upload confirmation. Additional UI fixtures validate English, Chinese, narrow layouts and the extension-origin panel.

Fixtures do not verify authenticated live E3 data, real model extraction quality, OS notification banners or Safari/iPad hardware behavior.
