import { baseName, download } from '../files.js';
import { toInstancesJson } from '../lib/export/json.js';
import { toAnnotatedText } from '../lib/export/text.js';
import { toHtmlReport } from '../lib/export/html.js';

export default function ExportBar({ result, dumpName }) {
  const base = baseName(dumpName);
  return (
    <div className="exports">
      <button type="button" onClick={() => download(`${base}-annotated.html`, toHtmlReport(result, { dumpFile: dumpName }), 'text/html')}>HTML report</button>
      <button type="button" onClick={() => download(`${base}-instances.json`, JSON.stringify(toInstancesJson(result, { dumpFile: dumpName }), null, 2), 'application/json')}>JSON instances</button>
      <button type="button" onClick={() => download(`${base}-annotated.txt`, toAnnotatedText(result), 'text/plain')}>Annotated text</button>
      {!result.options.redact && <span className="warn">Exports include secrets</span>}
    </div>
  );
}
