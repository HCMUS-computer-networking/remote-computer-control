// ModuleTable.jsx — shared table template used by ApplicationTab and ProcessTab.
//
// Placed directly under src/components/ (not in a subfolder) because it is a
// cross-feature primitive. Module tabs stay thin: they only declare COLUMNS
// and an actionColumn render — the sort state, toolbar, scroll container,
// click-to-sort headers, and empty state all live here.
//
// The template is pure UI — it never imports any store or service.

import { useState }              from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

// Props:
//   columns       — array of { key, label, numeric?, render? }
//                     render(row) is optional; defaults to row[key].
//                     numeric=true right-aligns the cell and sorts by number.
//   rows          — array of data objects to display
//   actionColumn  — { header, render(row) } appended as the last column
//   empty_label   — string shown when rows.length === 0
//   title         — string shown in the toolbar (top-left)
//   poll_badge    — bool, shows the "● Live" badge in the toolbar
//   row_key       — function(row) → unique key; defaults to first column value
function ModuleTable(
{
    columns,
    rows,
    actionColumn,
    empty_label = 'No data',
    title,
    poll_badge  = false,
    row_key,
})
{
    // Sort state is UI-only — it does not belong in any store.
    // Default to the first column, descending, so numeric tables (like Process
    // sorted by CPU) look useful on first render.
    const [sort_col, setSortCol] = useState(columns[0].key)
    const [sort_dir, setSortDir] = useState('desc')

    // Click a column header: toggle direction if already active;
    // switch column + reset to 'desc' otherwise.
    function handleSortClick(col_key)
    {
        if (col_key === sort_col)
        {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        }
        else
        {
            setSortCol(col_key)
            setSortDir('desc')
        }
    }

    // Sort a COPY of rows — never mutate the array the parent passed in.
    const sorted_rows = [...rows].sort(function (a, b)
    {
        const a_val = a[sort_col]
        const b_val = b[sort_col]

        if (typeof a_val === 'string')
        {
            return sort_dir === 'asc'
                ? a_val.localeCompare(b_val)
                : b_val.localeCompare(a_val)
        }

        return sort_dir === 'asc' ? a_val - b_val : b_val - a_val
    })

    // Default row key extractor uses the first column value (usually a unique name/id).
    const getRowKey = row_key ?? ((row) => row[columns[0].key])

    return (
        <div className="module-table">

            {/* ── toolbar ──────────────────────────────────────────── */}
            <div className="module-table__toolbar">
                <span className="module-table__title">
                    {title}
                </span>
                {poll_badge && (
                    <span className="module-table__poll-badge">● Live</span>
                )}
            </div>

            {/* ── scrollable table ─────────────────────────────────── */}
            <div className="module-table__scroll">
                <table>
                    <thead>
                        <tr>
                            {columns.map(function ({ key, label, numeric })
                            {
                                const is_active  = sort_col === key
                                const SortIcon   = sort_dir === 'asc' ? ChevronUp : ChevronDown
                                const th_classes = [
                                    'module-table__th',
                                    'module-table__th--sortable',
                                    is_active ? 'module-table__th--active' : '',
                                    numeric   ? 'module-table__th--num'    : '',
                                ].filter(Boolean).join(' ')

                                return (
                                    <th
                                        key={key}
                                        className={th_classes}
                                        onClick={() => handleSortClick(key)}
                                        title={`Sort by ${label}`}
                                    >
                                        <span className="module-table__th-inner">
                                            {label}
                                            {is_active && (
                                                <SortIcon size={12} strokeWidth={2} />
                                            )}
                                        </span>
                                    </th>
                                )
                            })}
                            {actionColumn && (
                                <th className="module-table__th module-table__th--action">
                                    <span className="module-table__th-inner">
                                        {actionColumn.header}
                                    </span>
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {sorted_rows.map(function (row)
                        {
                            return (
                                <tr key={getRowKey(row)} className="module-table__row">

                                    {columns.map(function ({ key, numeric, render })
                                    {
                                        const cell_classes = [
                                            'module-table__td',
                                            numeric ? 'module-table__td--num' : '',
                                        ].filter(Boolean).join(' ')

                                        return (
                                            <td key={key} className={cell_classes}>
                                                {render ? render(row) : row[key]}
                                            </td>
                                        )
                                    })}

                                    {actionColumn && (
                                        <td className="module-table__td module-table__td--action">
                                            {actionColumn.render(row)}
                                        </td>
                                    )}

                                </tr>
                            )
                        })}
                    </tbody>
                </table>

                {sorted_rows.length === 0 && (
                    <div className="module-table__empty">{empty_label}</div>
                )}
            </div>

        </div>
    )
}

export default ModuleTable
