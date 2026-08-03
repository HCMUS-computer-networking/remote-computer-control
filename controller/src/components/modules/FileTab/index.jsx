/* FileTab — browse, download, and upload files inside the Agent's sandbox.
   ALL operations are restricted to the sandbox directory on the Agent side.
   The Agent rejects any path that escapes outside it, so the Controller
   never accesses arbitrary files on the remote machine. */
import { useState, useEffect, useRef } from 'react'
import {
    Folder, FolderOpen, FileText, FileImage, File,
    ChevronRight, ChevronDown, Download, Upload,
    Loader2, RefreshCw, Lock, CheckCircle, XCircle, X, WifiOff,
} from 'lucide-react'

import useModuleStore                      from '../../../store/ModuleStore'
import usePolicyStore                      from '../../../store/PolicyStore'
import useUiStore                          from '../../../store/UiStore'
import useAgentSocket                      from '../../../hooks/UseAgentSocket'
import { useGuardedSend, usePendingConsent } from '../../PermissionGate'
import { buildFsList, buildFsGet, buildFsPut } from '../../../services/Protocol'

// ── Constants ────────────────────────────────────────────────────────────────

// Each upload is split into chunks this large before being sent.
// Smaller chunks = smoother progress bar but more round-trips.
const CHUNK_SIZE_BYTES = 32 * 1024   // 32 KB per chunk

// All uploaded files land in this sandbox folder.
const UPLOAD_DEST_DIR  = '/uploads'

// Indent each tree depth level by this many pixels.
const DEPTH_PX = 16

// ── Stable defaults ───────────────────────────────────────────────────────────

const EMPTY_FILE_STATE      = { tree: {}, path: '/' }   // avoids new object on every selector call
const EMPTY_FILE_DOWNLOADS  = {}                          // stable identity for empty map slice

// How long to keep the Blob URL alive after triggering the browser download.
// Long enough for slow save dialogs; short enough that memory is reclaimed.
const BLOB_URL_TTL_MS = 60 * 1000

// If a download job goes this long without a new chunk arriving (WS drop /
// Agent hang), abandon it: mark error, toast, and free the buffered bytes.
const DOWNLOAD_STALE_MS      = 15 * 1000
const DOWNLOAD_SCAN_EVERY_MS = 5  * 1000

// ── File-type icon map ────────────────────────────────────────────────────────

const EXT_ICONS =
{
    txt  : FileText,
    log  : FileText,
    csv  : FileText,
    json : FileText,
    jpg  : FileImage,
    jpeg : FileImage,
    png  : FileImage,
    gif  : FileImage,
}

function getFileIcon(name)
{
    const ext = name.split('.').pop().toLowerCase()
    return EXT_ICONS[ext] ?? File
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function formatSize(bytes)
{
    if (bytes === null || bytes === undefined) return ''
    if (bytes < 1024)        return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Collapse duplicate slashes so "//" becomes "/".
function normalizePath(p)
{
    return p.replace(/\/+/g, '/')
}

// Sandbox path validation used by the "Go to path" input. Returns an error
// message string for display, or '' when the path is valid (or empty — the
// button stays disabled instead of showing an error).
function validateSandboxPath(raw)
{
    const value = raw.trim()
    if (value === '')                    return ''   // untyped: not an error
    if (value.indexOf('\0') !== -1)      return 'Path must not contain NUL bytes'
    if (!value.startsWith('/'))          return 'Path must start with "/"'
    if (value.split('/').includes('..')) return 'Path must not contain ".." segments'
    return ''
}

// Encode a Uint8Array slice to a base64 string without using spread (avoids
// stack overflow on large arrays that would blow the call stack in some engines).
function uint8ToBase64(bytes)
{
    let binary = ''
    const len  = bytes.length
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}

// Assemble the ordered Uint8Array chunks into a Blob, trigger the browser
// download, then revoke the object URL after a delay so the save dialog has
// time to grab the bytes (revoking immediately can abort slow downloads).
function triggerBlobDownload(filename, byte_chunks)
{
    try
    {
        const blob = new Blob(byte_chunks)
        const url  = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href     = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_TTL_MS)
    }
    catch (err)
    {
        console.error('[FileTab] triggerBlobDownload failed:', err)
    }
}

// ── Component ─────────────────────────────────────────────────────────────────

function FileTab({ agent })
{
    const { sendToFocused } = useAgentSocket()
    const guardedSend       = useGuardedSend()
    const is_pending        = usePendingConsent()

    // Sandbox root comes from the pushed security policy (NOT hard-coded here).
    const sandbox_path = usePolicyStore((s) => s.sandbox_path)

    // Store slices — scoped to this agent only.
    const file_state       = useModuleStore((s) => s.data[agent.id]?.file           ?? EMPTY_FILE_STATE)
    const download_jobs    = useModuleStore((s) => s.data[agent.id]?.file_downloads ?? EMPTY_FILE_DOWNLOADS)
    const put_ack          = useModuleStore((s) => s.data[agent.id]?.file_put_ack   ?? null)
    const removeFileDownload = useModuleStore((s) => s.removeFileDownload)
    const clearFilePutAck    = useModuleStore((s) => s.clearFilePutAck)
    const clearModule        = useModuleStore((s) => s.clearModule)
    const addToast           = useUiStore((s) => s.addToast)

    // ── "Go to path" form state ─────────────────────────────────────────
    // Lets the operator jump the sandbox tree straight to a deep path
    // (e.g. /reports/2024) instead of expanding folders one by one.
    const [path_input, setPathInput] = useState('')
    const path_error = validateSandboxPath(path_input)   // '' when valid or empty

    // ── Tree state ────────────────────────────────────────────────────────
    const [open_dirs,        setOpenDirs]        = useState(new Set(['/']))
    const [loading_path,     setLoadingPath]     = useState(null)
    const [downloading_path, setDownloadingPath] = useState(null)

    // Track which transfer_ids have already been handed to the browser so we
    // don't double-download the same job if React re-runs the effect.
    const finished_dl_ref = useRef(new Set())

    // ── Upload state ──────────────────────────────────────────────────────
    // Each job: { id, name, dest_path, total_size, total_chunks, sent_chunks, status, error }
    // status: 'sending' | 'done' | 'error'
    const [uploads,   setUploads]   = useState([])
    const [drag_over, setDragOver]  = useState(false)

    // Chunk data kept in a ref (not state) so the ack effect can read it without
    // going stale. Shape: { [dest_path]: { chunks: string[], total_size, total_chunks } }
    const ul_chunks_ref   = useRef({})
    const last_ack_seq_ref = useRef(null)

    // Hidden file input used as a click-to-browse fallback.
    const file_input_ref = useRef(null)

    // ── On agent switch: reset all local state ────────────────────────────
    useEffect(function ()
    {
        setOpenDirs(new Set(['/']))
        setLoadingPath(null)
        setDownloadingPath(null)
        finished_dl_ref.current = new Set()
        ul_chunks_ref.current   = {}

        // Offline agents cannot answer — skip the sandbox request entirely.
        if (!agent.online) return

        const current_tree = useModuleStore.getState().data[agent.id]?.file?.tree ?? {}
        if (!current_tree['/'])
        {
            // First list request auto-triggers consent when needed.
            guardedSend(function () { sendToFocused(buildFsList('/')) })
            setLoadingPath('/')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agent.id, agent.online])

    // ── Clear loading spinner when the fetched path arrives in the tree ───
    useEffect(function ()
    {
        if (loading_path !== null && file_state.tree[loading_path] !== undefined)
        {
            setLoadingPath(null)
        }
    }, [file_state.tree, loading_path])

    // ── Stale download GC: a WS drop mid-transfer would otherwise leave the
    //    progress bar frozen forever. Every DOWNLOAD_SCAN_EVERY_MS, look for
    //    incomplete jobs whose most recent chunk (`_seq`) is older than
    //    DOWNLOAD_STALE_MS and drop them with an error toast.
    useEffect(function ()
    {
        const timer = setInterval(function ()
        {
            const jobs_now = useModuleStore.getState().data[agent.id]?.file_downloads ?? {}
            const cutoff   = Date.now() - DOWNLOAD_STALE_MS
            for (const transfer_id of Object.keys(jobs_now))
            {
                const job = jobs_now[transfer_id]
                if (job.received_chunks >= job.total_chunks) continue   // completing next tick
                if (job._seq > cutoff)                       continue   // still fresh

                addToast(`Tải ${job.path.split('/').pop()} bị treo — huỷ.`, 'error')
                removeFileDownload(agent.id, transfer_id)
                if (downloading_path === job.path) setDownloadingPath(null)
            }
        }, DOWNLOAD_SCAN_EVERY_MS)
        return () => clearInterval(timer)
    }, [agent.id, addToast, removeFileDownload, downloading_path])

    // ── Watch download jobs: when a job reaches total_chunks, assemble the
    //    Blob, trigger the browser download, then drop the job from the store.
    useEffect(function ()
    {
        for (const transfer_id of Object.keys(download_jobs))
        {
            const job = download_jobs[transfer_id]
            if (finished_dl_ref.current.has(transfer_id))       continue
            if (job.received_chunks < job.total_chunks)         continue

            finished_dl_ref.current.add(transfer_id)
            triggerBlobDownload(job.path.split('/').pop(), job.chunks)

            // Clear the "downloading" spinner on the file row if it was ours.
            if (downloading_path === job.path) setDownloadingPath(null)

            // Free the buffered bytes from the store; the browser owns the Blob now.
            removeFileDownload(agent.id, transfer_id)
            finished_dl_ref.current.delete(transfer_id)
        }
    }, [download_jobs, agent.id, downloading_path, removeFileDownload])

    // ── Consume fs_put_result / fs_put_complete: advance progress bar ─────
    useEffect(function ()
    {
        if (!put_ack) return
        if (put_ack._seq === last_ack_seq_ref.current) return
        last_ack_seq_ref.current = put_ack._seq

        const { path, chunk_index, success, complete } = put_ack

        if (complete)
        {
            // All chunks have arrived at the Agent — mark upload as done.
            setUploads((prev) => prev.map((job) =>
                job.dest_path === path
                    ? { ...job, sent_chunks: job.total_chunks, status: 'done' }
                    : job
            ))
            delete ul_chunks_ref.current[path]
        }
        else if (success)
        {
            const info       = ul_chunks_ref.current[path]
            const next_index = chunk_index + 1

            // Advance the progress counter.
            setUploads((prev) => prev.map((job) =>
                job.dest_path === path
                    ? { ...job, sent_chunks: next_index }
                    : job
            ))

            // If more chunks remain, send the next one now. Wrap the builder
            // in try/catch: a defensive validator throw (bad base64, wrong
            // transfer_id, etc.) would otherwise strand the job at 'sending'
            // forever with no user feedback.
            if (info && next_index < info.total_chunks)
            {
                try
                {
                    sendToFocused(buildFsPut(path,
                    {
                        transfer_id  : info.transfer_id,
                        total_size   : info.total_size,
                        chunk_index  : next_index,
                        total_chunks : info.total_chunks,
                        data_base64  : info.chunks[next_index],
                    }))
                }
                catch (err)
                {
                    setUploads((prev) => prev.map((job) =>
                        job.dest_path === path
                            ? { ...job, status: 'error', error: err.message ?? 'Chunk build failed' }
                            : job
                    ))
                    delete ul_chunks_ref.current[path]
                }
            }
        }
        else
        {
            // Chunk was rejected (e.g. path outside sandbox).
            setUploads((prev) => prev.map((job) =>
                job.dest_path === path
                    ? { ...job, status: 'error', error: put_ack.message ?? 'Upload failed' }
                    : job
            ))
            delete ul_chunks_ref.current[path]
        }

        clearFilePutAck(agent.id)
    }, [put_ack])

    // ── Read files from a FileList, split into chunks, start sending ──────
    async function handleFiles(file_list)
    {
        for (const file of file_list)
        {
            const buffer      = await file.arrayBuffer()
            const all_bytes   = new Uint8Array(buffer)
            const total_chunks = Math.max(1, Math.ceil(all_bytes.length / CHUNK_SIZE_BYTES))
            const dest_path   = normalizePath(UPLOAD_DEST_DIR + '/' + file.name)

            // Pre-compute every chunk's base64 string so the ack handler can
            // access them without re-reading the file.
            const chunks = []
            for (let i = 0; i < total_chunks; i++)
            {
                const slice = all_bytes.slice(i * CHUNK_SIZE_BYTES, (i + 1) * CHUNK_SIZE_BYTES)
                chunks.push(uint8ToBase64(slice))
            }

            // One transfer_id per file — every chunk of this upload carries the
            // same id so the Agent can stitch them back together (File.json spec).
            const transfer_id = crypto.randomUUID()
            ul_chunks_ref.current[dest_path] = { chunks, total_size: file.size, total_chunks, transfer_id }

            // Add a job card to the upload list.
            setUploads((prev) =>
            [
                ...prev,
                {
                    id           : `${Date.now()}-${file.name}`,
                    name         : file.name,
                    dest_path,
                    total_size   : file.size,
                    total_chunks,
                    sent_chunks  : 0,
                    status       : 'sending',
                    error        : null,
                },
            ])

            // Kick off the first chunk; the rest are sent after each ack arrives.
            // First chunk is guarded — subsequent chunks (fired from the ack
            // effect) skip the wrap since consent is already granted by then.
            guardedSend(function ()
            {
                sendToFocused(buildFsPut(dest_path,
                {
                    transfer_id,
                    total_size   : file.size,
                    chunk_index  : 0,
                    total_chunks,
                    data_base64  : chunks[0],
                }))
            })
        }
    }

    // ── Drag-and-drop handlers ────────────────────────────────────────────

    function handleDragOver(e)
    {
        e.preventDefault()
        setDragOver(true)
    }

    function handleDragLeave(e)
    {
        // Only clear when the cursor leaves the drop zone entirely (not child elements).
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
    }

    function handleDrop(e)
    {
        e.preventDefault()
        setDragOver(false)
        const files = e.dataTransfer?.files
        if (files?.length) handleFiles(files)
    }

    function handleInputChange(e)
    {
        const files = e.target.files
        if (files?.length) handleFiles(files)
        e.target.value = ''   // reset so the same file can be re-selected
    }

    // ── Tree navigation helpers ───────────────────────────────────────────

    function fetchDir(path)
    {
        setLoadingPath(path)
        guardedSend(function () { sendToFocused(buildFsList(path)) })
    }

    function handleDirToggle(entry_name, parent_path)
    {
        const child_path = normalizePath(parent_path + '/' + entry_name)
        const next_open  = new Set(open_dirs)

        if (open_dirs.has(child_path))
        {
            for (const p of next_open)
            {
                if (p === child_path || p.startsWith(child_path + '/')) next_open.delete(p)
            }
        }
        else
        {
            next_open.add(child_path)
            if (!file_state.tree[child_path]) fetchDir(child_path)
        }

        setOpenDirs(next_open)
    }

    function handleDownload(full_path)
    {
        setDownloadingPath(full_path)
        guardedSend(function () { sendToFocused(buildFsGet(full_path)) })
    }

    // Jump the tree to a user-typed sandbox path. Fetches its listing (if not
    // cached) and expands every ancestor so the target row is visible.
    function handleGoToPath(e)
    {
        e.preventDefault()
        const value = normalizePath(path_input.trim())
        if (path_error || value === '') return
        try
        {
            guardedSend(function () { sendToFocused(buildFsList(value)) })
            setLoadingPath(value)
            const next_open = new Set(open_dirs)
            const segments  = value.split('/').filter(Boolean)
            let acc = ''
            next_open.add('/')
            for (const seg of segments)
            {
                acc += '/' + seg
                next_open.add(acc)
            }
            setOpenDirs(next_open)
        }
        catch (err)
        {
            addToast(err.message ?? 'Invalid sandbox path', 'error')
        }
    }

    function handleRefresh()
    {
        clearModule(agent.id, 'file')
        setOpenDirs(new Set(['/']))
        setLoadingPath('/')
        // Drop any in-flight download bookkeeping — the tree is being reset.
        for (const tid of Object.keys(download_jobs)) removeFileDownload(agent.id, tid)
        finished_dl_ref.current = new Set()
        guardedSend(function () { sendToFocused(buildFsList('/')) })
    }

    // Remove jobs that have finished or errored from the upload list.
    function clearDoneUploads()
    {
        setUploads((prev) => prev.filter((j) => j.status === 'sending'))
    }

    // ── Recursive tree renderer ───────────────────────────────────────────

    function renderEntries(parent_path, depth)
    {
        const entries = file_state.tree[parent_path]
        if (!entries) return null

        return entries.map(function (entry)
        {
            const full_path = normalizePath(parent_path + '/' + entry.name)

            if (entry.type === 'directory')
            {
                const is_open     = open_dirs.has(full_path)
                const is_fetching = loading_path === full_path && !file_state.tree[full_path]
                const ChevronIcon = is_open ? ChevronDown  : ChevronRight
                const FolderIcon  = is_open ? FolderOpen   : Folder

                return (
                    <div key={full_path}>
                        <button
                            className="file-tab__row file-tab__row--dir"
                            style={{ paddingLeft: 12 + depth * DEPTH_PX }}
                            onClick={() => handleDirToggle(entry.name, parent_path)}
                            title={`Sandbox path: ${full_path}`}
                        >
                            <FolderIcon size={14} className="file-tab__icon" />
                            <span className="file-tab__name">{entry.name}</span>
                            {is_fetching
                                ? <Loader2 size={12} className="file-tab__spin" />
                                : <ChevronIcon size={12} className="file-tab__chevron" />
                            }
                        </button>
                        {is_open && renderEntries(full_path, depth + 1)}
                    </div>
                )
            }

            const is_downloading = downloading_path === full_path
            const IconComp       = getFileIcon(entry.name)

            return (
                <div
                    key={full_path}
                    className="file-tab__row file-tab__row--file"
                    style={{ paddingLeft: 12 + depth * DEPTH_PX }}
                >
                    <IconComp size={14} className="file-tab__icon file-tab__icon--file" />
                    <span className="file-tab__name">{entry.name}</span>
                    <span className="file-tab__size">{formatSize(entry.size)}</span>
                    <button
                        className="action-btn action-btn--neutral file-tab__dl-btn"
                        onClick={() => handleDownload(full_path)}
                        disabled={is_downloading || is_pending}
                        title={is_pending ? 'Đang xin quyền...' : `Download ${entry.name} from sandbox`}
                    >
                        {is_downloading
                            ? <Loader2 size={12} className="file-tab__spin" />
                            : <Download size={12} />
                        }
                    </button>
                </div>
            )
        })
    }

    // ── Derived values ────────────────────────────────────────────────────

    const root_loaded      = file_state.tree['/'] !== undefined
    const has_done_uploads = uploads.some((j) => j.status !== 'sending')

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <div className="file-tab">

            {/* ── Toolbar ─────────────────────────────────────────── */}
            <div className="file-tab__toolbar">
                <span className="file-tab__title">Files — {agent.name}</span>
                <span
                    className="file-tab__sandbox-badge"
                    title={`All file operations are restricted to the Agent sandbox: ${sandbox_path}`}
                >
                    <Lock size={10} /> sandbox only
                </span>
                <button
                    className="action-btn action-btn--neutral"
                    onClick={handleRefresh}
                    disabled={!agent.online || is_pending}
                    title={is_pending ? 'Đang xin quyền...' : agent.online ? 'Refresh root listing' : 'Agent is offline'}
                >
                    <RefreshCw size={12} /> Refresh
                </button>
            </div>

            {/* ── Go-to-path form (jump to a sandbox path directly) ── */}
            {agent.online && (
                <form className="form-inline" onSubmit={handleGoToPath}>
                    <label htmlFor="fs-goto-path" className="form-inline__label">Go to path:</label>
                    <input
                        id="fs-goto-path"
                        className={`form-inline__input form-inline__input--wide${path_error ? ' form-inline__input--error' : ''}`}
                        type="text"
                        placeholder="/reports/2024"
                        value={path_input}
                        onChange={(e) => setPathInput(e.target.value)}
                        aria-invalid={Boolean(path_error)}
                        aria-describedby={path_error ? 'fs-goto-path-error' : undefined}
                    />
                    <button
                        type="submit"
                        className="action-btn action-btn--neutral"
                        disabled={Boolean(path_error) || path_input.trim() === '' || is_pending}
                    >
                        Go
                    </button>
                    {path_error && (
                        <span id="fs-goto-path-error" className="form-inline__error">{path_error}</span>
                    )}
                </form>
            )}

            {/* ── Upload drop zone (hidden while the agent is offline) ── */}
            {agent.online && (
                /* eslint-disable-next-line jsx-a11y/click-events-have-key-events */
                <div
                    className={`file-tab__drop-zone${drag_over ? ' file-tab__drop-zone--over' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => file_input_ref.current?.click()}
                    title={`Upload files to ${UPLOAD_DEST_DIR}/`}
                >
                    <Upload size={18} className="file-tab__drop-icon" />
                    <span className="file-tab__drop-label">
                        {drag_over
                            ? 'Release to upload'
                            : <>Drop files here or <u>browse</u> → <code>{UPLOAD_DEST_DIR}/</code></>
                        }
                    </span>
                    {/* Hidden input as a click-to-browse fallback */}
                    <input
                        ref={file_input_ref}
                        type="file"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleInputChange}
                    />
                </div>
            )}

            {/* ── Download progress list (in-flight fs_get chunks) ───── */}
            {Object.keys(download_jobs).length > 0 && (
                <div className="file-tab__upload-list">
                    <div className="file-tab__upload-list-header">
                        <span className="file-tab__upload-list-title">Downloads</span>
                    </div>

                    {Object.values(download_jobs).map(function (job)
                    {
                        const pct       = job.total_chunks === 0
                            ? 100
                            : Math.round((job.received_chunks / job.total_chunks) * 100)
                        const file_name = job.path.split('/').pop()

                        return (
                            <div key={job.transfer_id} className="file-tab__upload-job">
                                <div className="file-tab__upload-info">
                                    <Loader2 size={13} className="file-tab__spin file-tab__upload-icon" />
                                    <span className="file-tab__upload-name" title={job.path}>
                                        {file_name}
                                    </span>
                                    <span className="file-tab__upload-pct file-tab__upload-pct--sending">
                                        {`${pct}%`}
                                    </span>
                                    <span className="file-tab__upload-size">
                                        {formatSize(job.total_size)}
                                    </span>
                                </div>
                                <div className="file-tab__progress-track">
                                    <div
                                        className="file-tab__progress-fill file-tab__progress-fill--sending"
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* ── Upload progress list ─────────────────────────────── */}
            {uploads.length > 0 && (
                <div className="file-tab__upload-list">
                    {/* Header row with a "clear done" button */}
                    <div className="file-tab__upload-list-header">
                        <span className="file-tab__upload-list-title">Uploads</span>
                        {has_done_uploads && (
                            <button
                                className="action-btn action-btn--neutral file-tab__clear-done"
                                onClick={clearDoneUploads}
                                title="Remove finished and failed uploads from the list"
                            >
                                <X size={11} /> Clear done
                            </button>
                        )}
                    </div>

                    {uploads.map(function (job)
                    {
                        const pct = job.total_chunks === 0
                            ? 100
                            : Math.round((job.sent_chunks / job.total_chunks) * 100)

                        return (
                            <div key={job.id} className="file-tab__upload-job">

                                {/* Name row: icon + name + status label */}
                                <div className="file-tab__upload-info">
                                    {job.status === 'done'
                                        ? <CheckCircle size={13} className="file-tab__upload-icon file-tab__upload-icon--done" />
                                        : job.status === 'error'
                                            ? <XCircle size={13} className="file-tab__upload-icon file-tab__upload-icon--error" />
                                            : <Loader2 size={13} className="file-tab__spin file-tab__upload-icon" />
                                    }
                                    <span className="file-tab__upload-name" title={job.dest_path}>
                                        {job.name}
                                    </span>
                                    <span className={`file-tab__upload-pct file-tab__upload-pct--${job.status}`}>
                                        {job.status === 'done'  ? 'Done'
                                        : job.status === 'error' ? 'Error'
                                        :                          `${pct}%`}
                                    </span>
                                    <span className="file-tab__upload-size">
                                        {formatSize(job.total_size)}
                                    </span>
                                </div>

                                {/* Progress bar track + fill */}
                                <div className="file-tab__progress-track">
                                    <div
                                        className={`file-tab__progress-fill file-tab__progress-fill--${job.status}`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>

                                {/* Error message row (only shown on failure) */}
                                {job.error && (
                                    <span className="file-tab__upload-error">{job.error}</span>
                                )}

                            </div>
                        )
                    })}
                </div>
            )}

            {/* ── File tree ────────────────────────────────────────── */}
            <div className="file-tab__tree">
                {!agent.online
                    ? (
                        <div className="file-tab__empty">
                            <WifiOff size={28} />
                            <span>Agent is offline — sandbox unavailable</span>
                        </div>
                    )
                    : !root_loaded
                        ? (
                            <div className="file-tab__empty">
                                <Loader2 size={28} className="file-tab__spin" />
                                <span>Loading sandbox…</span>
                            </div>
                        )
                        : renderEntries('/', 0)
                }
            </div>

        </div>
    )
}

export default FileTab
