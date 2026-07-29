#![allow(clippy::too_many_arguments)]

use smallvec::SmallVec;
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::HashMap;

const COLUMN_F32: u32 = 1;
const COLUMN_F64: u32 = 2;
const COLUMN_U8: u32 = 3;
const COLUMN_U16: u32 = 4;
const COLUMN_U32: u32 = 5;
const COLUMN_GENERATED_OVERLAP_X: u32 = 6;

#[derive(Default)]
struct Column {
    kind: u32,
    bytes: Vec<u8>,
}

impl Column {
    #[inline(always)]
    fn read(&self, index: usize) -> f64 {
        unsafe {
            match self.kind {
                COLUMN_F32 => {
                    (self.bytes.as_ptr().add(index * 4) as *const f32).read_unaligned() as f64
                }
                COLUMN_F64 => (self.bytes.as_ptr().add(index * 8) as *const f64).read_unaligned(),
                COLUMN_U8 => *self.bytes.as_ptr().add(index) as f64,
                COLUMN_U16 => {
                    (self.bytes.as_ptr().add(index * 2) as *const u16).read_unaligned() as f64
                }
                COLUMN_U32 => {
                    (self.bytes.as_ptr().add(index * 4) as *const u32).read_unaligned() as f64
                }
                COLUMN_GENERATED_OVERLAP_X => generated_overlap_x(index) as f64,
                _ => f64::NAN,
            }
        }
    }
}

#[derive(Default)]
struct HeatResult {
    counts: Vec<u32>,
    hovered: Vec<u8>,
    membership_counts: Vec<u32>,
    membership_offsets: Vec<u32>,
    populated_count: u32,
    selected_counts: Vec<u32>,
    source_indices: Vec<u32>,
    x_bin_count: u32,
    y_bin_count: u32,
}

#[derive(Default)]
struct BubbleResult {
    center_x: Vec<f64>,
    center_y: Vec<f64>,
    counts: Vec<u32>,
    hovered: Vec<u8>,
    membership_counts: Vec<u32>,
    membership_offsets: Vec<u32>,
    selected_counts: Vec<u32>,
    singleton_count: u32,
    source_indices: Vec<u32>,
    total_aggregate_count: u32,
}

#[derive(Default)]
struct HistogramResult {
    color_counts: Vec<u32>,
    color_offsets: Vec<u32>,
    color_values: Vec<u32>,
    counts: Vec<u32>,
    domain_max: f64,
    domain_min: f64,
    hovered: Vec<u8>,
    invalid_count: u32,
    out_of_domain_count: u32,
    selected_counts: Vec<u32>,
    source_indices: Vec<u32>,
    total_count: u32,
    visited_count: u32,
}

struct HistogramColorCount {
    color: u32,
    count: u32,
    first_row_index: u32,
    first_value: f64,
}

#[derive(Default)]
struct HistogramColumnIndex {
    domain_max: f64,
    domain_min: f64,
    invalid_count: u32,
    out_of_domain_count: u32,
    row_indices_by_value: Vec<u32>,
}

#[derive(Default)]
struct HistogramSession {
    color: Option<Vec<u32>>,
    column_indices: Vec<Option<HistogramColumnIndex>>,
    columns: Vec<Column>,
    point_count: usize,
    results: Vec<HistogramResult>,
    selected: Vec<u8>,
    selection_input: Vec<u32>,
    source_index: Option<Vec<u32>>,
}

#[derive(Default)]
struct Session {
    point_count: usize,
    x: Column,
    x_order: Option<Vec<u32>>,
    y: Vec<Column>,
    source_index: Option<Vec<u32>>,
    selected: Vec<u8>,
    selected_count: usize,
    selection_input: Vec<u32>,
    heat_results: Vec<HeatResult>,
    bubble_results: Vec<BubbleResult>,
}

thread_local! {
    static SESSION: RefCell<Session> = RefCell::new(Session::default());
    static HISTOGRAM_SESSION: RefCell<HistogramSession> =
        RefCell::new(HistogramSession::default());
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_session_reset(point_count: u32, column_count: u32) {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        *session = HistogramSession {
            column_indices: (0..column_count).map(|_| None).collect(),
            columns: (0..column_count).map(|_| Column::default()).collect(),
            point_count: point_count as usize,
            ..HistogramSession::default()
        };
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_column_prepare_index(
    slot: u32,
    domain_min: f64,
    domain_max: f64,
) -> u32 {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        if !domain_min.is_finite() || !domain_max.is_finite() || domain_max < domain_min {
            return u32::MAX;
        }
        let Some(column) = session.columns.get(slot as usize) else {
            return u32::MAX;
        };
        let mut index = HistogramColumnIndex {
            domain_max: f64::NEG_INFINITY,
            domain_min: f64::INFINITY,
            ..HistogramColumnIndex::default()
        };
        index.row_indices_by_value.reserve(session.point_count);
        for row_index in 0..session.point_count {
            let value = column.read(row_index);
            if !value.is_finite() {
                index.invalid_count = index.invalid_count.saturating_add(1);
                continue;
            }
            if value < domain_min || value > domain_max {
                index.out_of_domain_count = index.out_of_domain_count.saturating_add(1);
                continue;
            }
            index.domain_min = index.domain_min.min(value);
            index.domain_max = index.domain_max.max(value);
            index.row_indices_by_value.push(row_index as u32);
        }
        index.row_indices_by_value.sort_unstable_by(|left, right| {
            column
                .read(*left as usize)
                .partial_cmp(&column.read(*right as usize))
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.cmp(right))
        });
        let length = index.row_indices_by_value.len().min(u32::MAX as usize) as u32;
        let Some(target) = session.column_indices.get_mut(slot as usize) else {
            return u32::MAX;
        };
        *target = Some(index);
        length
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_column_reserve(slot: u32, kind: u32, byte_length: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        let Some(column) = session.columns.get_mut(slot as usize) else {
            return 0;
        };
        column.kind = kind;
        column.bytes.resize(byte_length as usize, 0);
        column.bytes.as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_set_source_index(enabled: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        if enabled == 0 {
            session.source_index = None;
            return 0;
        }
        session.source_index = Some(vec![0; session.point_count]);
        session.source_index.as_mut().unwrap().as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_set_color(enabled: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        if enabled == 0 {
            session.color = None;
            return 0;
        }
        session.color = Some(vec![u32::MAX; session.point_count]);
        session.color.as_mut().unwrap().as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_selection_reserve(length: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        session.results.clear();
        session.selection_input.resize(length as usize, 0);
        session.selection_input.as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_results_reset() {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        session.results.clear();
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_set_selection(pointer: u32, length: u32) {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        if pointer == 0 || length == 0 {
            session.selected.clear();
            return;
        }
        session.selected.resize(session.point_count, 0);
        session.selected.fill(0);
        let values = unsafe { std::slice::from_raw_parts(pointer as *const u32, length as usize) };
        for &source_index in values {
            if let Some(value) = session.selected.get_mut(source_index as usize) {
                *value = 1;
            }
        }
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_build(
    slot: u32,
    domain_min: f64,
    domain_max: f64,
    bin_size: f64,
    global_index_start: u32,
    total_bin_count: u32,
    visible_bin_count: u32,
    visible_min: f64,
    visible_max: f64,
    hover_source_index: i64,
    categorical: u32,
    include_membership: u32,
) -> u32 {
    HISTOGRAM_SESSION.with_borrow_mut(|session| {
        let Some(column) = session.columns.get(slot as usize) else {
            return u32::MAX;
        };
        let visible_count = visible_bin_count.max(1) as usize;
        let mut result = HistogramResult {
            color_offsets: vec![0; visible_count + 1],
            counts: vec![0; visible_count],
            domain_max: f64::NEG_INFINITY,
            domain_min: f64::INFINITY,
            hovered: vec![0; visible_count],
            selected_counts: vec![0; visible_count],
            ..HistogramResult::default()
        };
        let mut color_counts_by_bin: Vec<SmallVec<[HistogramColorCount; 8]>> =
            (0..visible_count).map(|_| SmallVec::new()).collect();
        let mut source_indices_by_bin: Vec<Vec<u32>> =
            if include_membership == 0 || categorical == 0 {
                Vec::new()
            } else {
                (0..visible_count).map(|_| Vec::new()).collect()
            };
        if !domain_min.is_finite()
            || !domain_max.is_finite()
            || !bin_size.is_finite()
            || bin_size <= 0.0
            || total_bin_count == 0
            || !visible_min.is_finite()
            || !visible_max.is_finite()
            || visible_max < visible_min
        {
            return u32::MAX;
        }
        let column_index = session
            .column_indices
            .get(slot as usize)
            .and_then(Option::as_ref)
            .filter(|_| categorical == 0);
        if let Some(index) = column_index {
            result.invalid_count = index.invalid_count;
            result.out_of_domain_count = index.out_of_domain_count;
            result.domain_min = index.domain_min;
            result.domain_max = index.domain_max;
        }
        let candidate_start = column_index.map_or(0, |index| {
            index
                .row_indices_by_value
                .partition_point(|row_index| column.read(*row_index as usize) < visible_min)
        });
        let candidate_end = column_index.map_or(session.point_count, |index| {
            index
                .row_indices_by_value
                .partition_point(|row_index| column.read(*row_index as usize) <= visible_max)
        });
        let visible_global_end = global_index_start
            .saturating_add(visible_bin_count)
            .min(total_bin_count);
        let visible_bin_max = if visible_global_end >= total_bin_count {
            domain_max
        } else {
            (domain_min + visible_global_end as f64 * bin_size).min(domain_max)
        };
        for candidate_index in candidate_start..candidate_end {
            let row_index = column_index.map_or(candidate_index, |index| {
                index.row_indices_by_value[candidate_index] as usize
            });
            result.visited_count = result.visited_count.saturating_add(1);
            let value = column.read(row_index);
            if !value.is_finite() {
                if column_index.is_none() {
                    result.invalid_count = result.invalid_count.saturating_add(1);
                }
                continue;
            }
            if value < domain_min || value > domain_max {
                if column_index.is_none() {
                    if categorical == 0 {
                        result.out_of_domain_count = result.out_of_domain_count.saturating_add(1);
                    } else {
                        result.invalid_count = result.invalid_count.saturating_add(1);
                    }
                }
                continue;
            }
            if column_index.is_none() {
                result.domain_min = result.domain_min.min(value);
                result.domain_max = result.domain_max.max(value);
            }
            let global_index = if value == visible_bin_max {
                visible_global_end.saturating_sub(1)
            } else {
                ((value - domain_min) / bin_size).floor().max(0.0) as u32
            };
            if global_index < global_index_start {
                continue;
            }
            let local_index = global_index - global_index_start;
            if local_index >= visible_bin_count {
                continue;
            }
            let local = local_index as usize;
            result.counts[local] = result.counts[local].saturating_add(1);
            result.total_count = result.total_count.saturating_add(1);
            let color = session
                .color
                .as_ref()
                .and_then(|values| values.get(row_index))
                .copied()
                .unwrap_or(u32::MAX);
            let color_counts = &mut color_counts_by_bin[local];
            if let Some(entry) = color_counts.iter_mut().find(|entry| entry.color == color) {
                entry.count = entry.count.saturating_add(1);
                if value < entry.first_value {
                    entry.first_value = value;
                    entry.first_row_index = row_index as u32;
                }
            } else {
                color_counts.push(HistogramColorCount {
                    color,
                    count: 1,
                    first_row_index: row_index as u32,
                    first_value: value,
                });
            }
            let source_index = session
                .source_index
                .as_ref()
                .and_then(|values| values.get(row_index))
                .copied()
                .unwrap_or(row_index as u32);
            if session.selected.get(source_index as usize).copied() == Some(1) {
                result.selected_counts[local] = result.selected_counts[local].saturating_add(1);
            }
            if hover_source_index >= 0 && source_index == hover_source_index as u32 {
                result.hovered[local] = 1;
            }
            if include_membership != 0 {
                if categorical == 0 {
                    result.source_indices.push(source_index);
                } else {
                    source_indices_by_bin[local].push(source_index);
                }
            }
        }
        for (bin_index, mut color_counts) in color_counts_by_bin.into_iter().enumerate() {
            if categorical == 0 {
                color_counts.sort_by(|left, right| {
                    left.first_value
                        .partial_cmp(&right.first_value)
                        .unwrap_or(Ordering::Equal)
                        .then_with(|| left.first_row_index.cmp(&right.first_row_index))
                });
            }
            result.color_offsets[bin_index] = result.color_values.len() as u32;
            for entry in color_counts {
                result.color_values.push(entry.color);
                result.color_counts.push(entry.count);
            }
        }
        result.color_offsets[visible_count] = result.color_values.len() as u32;
        if include_membership != 0 && categorical != 0 {
            result.source_indices.reserve(result.total_count as usize);
            for source_indices in source_indices_by_bin {
                result.source_indices.extend(source_indices);
            }
        }
        let index = session.results.len();
        session.results.push(result);
        index.min(u32::MAX as usize) as u32
    })
}

macro_rules! histogram_result_u32_accessors {
    ($ptr_name:ident, $len_name:ident, $field:ident) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $ptr_name(index: u32) -> u32 {
            HISTOGRAM_SESSION.with_borrow(|session| {
                session
                    .results
                    .get(index as usize)
                    .map_or(0, |result| result.$field.as_ptr() as u32)
            })
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $len_name(index: u32) -> u32 {
            HISTOGRAM_SESSION.with_borrow(|session| {
                session.results.get(index as usize).map_or(0, |result| {
                    result.$field.len().min(u32::MAX as usize) as u32
                })
            })
        }
    };
}

histogram_result_u32_accessors!(histogram_counts_ptr, histogram_counts_len, counts);
histogram_result_u32_accessors!(
    histogram_color_counts_ptr,
    histogram_color_counts_len,
    color_counts
);
histogram_result_u32_accessors!(
    histogram_color_offsets_ptr,
    histogram_color_offsets_len,
    color_offsets
);
histogram_result_u32_accessors!(
    histogram_color_values_ptr,
    histogram_color_values_len,
    color_values
);
histogram_result_u32_accessors!(
    histogram_selected_counts_ptr,
    histogram_selected_counts_len,
    selected_counts
);
histogram_result_u32_accessors!(
    histogram_source_indices_ptr,
    histogram_source_indices_len,
    source_indices
);

#[unsafe(no_mangle)]
pub extern "C" fn histogram_hovered_ptr(index: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(0, |result| result.hovered.as_ptr() as u32)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_hovered_len(index: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(0, |result| result.hovered.len() as u32)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_invalid_count(index: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(0, |result| result.invalid_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_out_of_domain_count(index: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(0, |result| result.out_of_domain_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_total_count(index: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(0, |result| result.total_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_visited_count(index: u32) -> u32 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(0, |result| result.visited_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_domain_min(index: u32) -> f64 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(f64::NAN, |result| result.domain_min)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn histogram_domain_max(index: u32) -> f64 {
    HISTOGRAM_SESSION.with_borrow(|session| {
        session
            .results
            .get(index as usize)
            .map_or(f64::NAN, |result| result.domain_max)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn session_reset(point_count: u32, y_count: u32) {
    SESSION.with_borrow_mut(|session| {
        *session = Session {
            point_count: point_count as usize,
            y: (0..y_count).map(|_| Column::default()).collect(),
            selected: vec![0; point_count as usize],
            ..Session::default()
        };
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn session_column_reserve(slot: u32, kind: u32, byte_length: u32) -> u32 {
    SESSION.with_borrow_mut(|session| {
        let column = if slot == 0 {
            &mut session.x
        } else {
            match session.y.get_mut((slot - 1) as usize) {
                Some(column) => column,
                None => return 0,
            }
        };
        column.kind = kind;
        column.bytes.resize(byte_length as usize, 0);
        column.bytes.as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn session_set_x_order(enabled: u32) -> u32 {
    SESSION.with_borrow_mut(|session| {
        if enabled == 0 {
            session.x_order = None;
            return 0;
        }
        session.x_order = Some(vec![0; session.point_count]);
        session.x_order.as_mut().unwrap().as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn session_set_source_index(enabled: u32) -> u32 {
    SESSION.with_borrow_mut(|session| {
        if enabled == 0 {
            session.source_index = None;
            return 0;
        }
        session.source_index = Some(vec![0; session.point_count]);
        session.source_index.as_mut().unwrap().as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn session_validate() -> u32 {
    SESSION.with_borrow(|session| {
        if column_element_count(&session.x) < session.point_count
            || session
                .y
                .iter()
                .any(|column| column_element_count(column) < session.point_count)
            || session.x_order.as_ref().is_some_and(|order| {
                order.len() != session.point_count
                    || order
                        .iter()
                        .any(|&index| index as usize >= session.point_count)
            })
            || session
                .source_index
                .as_ref()
                .is_some_and(|source| source.len() != session.point_count)
        {
            0
        } else {
            1
        }
    })
}

fn column_element_count(column: &Column) -> usize {
    match column.kind {
        COLUMN_F32 | COLUMN_U32 => column.bytes.len() / 4,
        COLUMN_F64 => column.bytes.len() / 8,
        COLUMN_U8 => column.bytes.len(),
        COLUMN_U16 => column.bytes.len() / 2,
        COLUMN_GENERATED_OVERLAP_X => usize::MAX,
        _ => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn session_set_selection(pointer: u32, length: u32) {
    SESSION.with_borrow_mut(|session| {
        session.selected.fill(0);
        session.selected_count = length as usize;
        if pointer == 0 || length == 0 {
            return;
        }
        let values = unsafe { std::slice::from_raw_parts(pointer as *const u32, length as usize) };
        for &source_index in values {
            if let Some(value) = session.selected.get_mut(source_index as usize) {
                *value = 1;
            }
        }
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn session_selection_reserve(length: u32) -> u32 {
    SESSION.with_borrow_mut(|session| {
        session.heat_results.clear();
        session.bubble_results.clear();
        session.selection_input.resize(length as usize, 0);
        session.selection_input.as_mut_ptr() as u32
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn session_selection_release(pointer: u32, length: u32) {
    let _ = (pointer, length);
    SESSION.with_borrow_mut(|session| session.selection_input.clear());
}

#[unsafe(no_mangle)]
pub extern "C" fn heatmap_results_clear() {
    SESSION.with_borrow_mut(|session| session.heat_results.clear());
}

#[unsafe(no_mangle)]
pub extern "C" fn heatmap_build(
    y_slot: u32,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    plot_width: f64,
    plot_height: f64,
    heat_bin_px: f64,
    hover_source_index: i64,
) -> u32 {
    SESSION.with_borrow_mut(|session| {
        let (x_min, x_max) = ordered_range(x_min, x_max);
        let (y_min, y_max) = ordered_range(y_min, y_max);
        let bin_px = if heat_bin_px.is_finite() {
            heat_bin_px.clamp(2.0, 128.0)
        } else {
            18.0
        };
        let x_bins = ((plot_width.max(1.0) / bin_px).ceil() as u32).max(1);
        let y_bins = ((plot_height.max(1.0) / bin_px).ceil() as u32).max(1);
        let x_scale = if x_max > x_min {
            x_bins as f64 / (x_max - x_min)
        } else {
            0.0
        };
        let y_scale = if y_max > y_min {
            y_bins as f64 / (y_max - y_min)
        } else {
            0.0
        };
        let cell_count = x_bins as usize * y_bins as usize;
        let mut result = HeatResult {
            counts: vec![0; cell_count],
            hovered: vec![0; cell_count],
            membership_counts: vec![0; cell_count],
            membership_offsets: vec![0; cell_count],
            selected_counts: vec![0; cell_count],
            x_bin_count: x_bins,
            y_bin_count: y_bins,
            ..HeatResult::default()
        };
        let y = match session.y.get(y_slot as usize) {
            Some(y) => y,
            None => return u32::MAX,
        };
        let (start, end) = scan_range(session, x_min, x_max);
        for sorted_index in start..end {
            let point_index = point_index_at(session, sorted_index);
            let x = session.x.read(point_index);
            let value = y.read(point_index);
            if !x.is_finite() || !value.is_finite() || value < y_min || value > y_max {
                continue;
            }
            let cell = heat_cell_scaled(
                x, value, x_min, x_max, y_min, y_max, x_scale, y_scale, x_bins, y_bins,
            );
            unsafe {
                *result.counts.get_unchecked_mut(cell) += 1;
            }
            if session.selected_count > 0 || hover_source_index >= 0 {
                let source = source_index_at(session, point_index);
                if session.selected_count > 0 {
                    unsafe {
                        *result.selected_counts.get_unchecked_mut(cell) +=
                            selected_at(session, source);
                    }
                }
                if hover_source_index >= 0 && source == hover_source_index as u32 {
                    unsafe {
                        *result.hovered.get_unchecked_mut(cell) = 1;
                    }
                }
            }
        }
        let mut total = 0u32;
        for cell in 0..cell_count {
            result.membership_offsets[cell] = total;
            result.membership_counts[cell] = result.counts[cell];
            total += result.counts[cell];
            if result.counts[cell] > 0 {
                result.populated_count += 1;
            }
        }
        result.source_indices.resize(total as usize, 0);
        let mut writes = result.membership_offsets.clone();
        for sorted_index in start..end {
            let point_index = point_index_at(session, sorted_index);
            let x = session.x.read(point_index);
            let value = y.read(point_index);
            if !x.is_finite() || !value.is_finite() || value < y_min || value > y_max {
                continue;
            }
            let cell = heat_cell_scaled(
                x, value, x_min, x_max, y_min, y_max, x_scale, y_scale, x_bins, y_bins,
            );
            let write = unsafe { *writes.get_unchecked(cell) as usize };
            unsafe {
                *result.source_indices.get_unchecked_mut(write) =
                    source_index_at(session, point_index);
                *writes.get_unchecked_mut(cell) += 1;
            }
        }
        if session.source_index.is_some() || session.x_order.is_some() {
            for cell in 0..cell_count {
                let start = result.membership_offsets[cell] as usize;
                let end = start + result.membership_counts[cell] as usize;
                result.source_indices[start..end].sort_unstable();
            }
        }
        let index = session.heat_results.len() as u32;
        session.heat_results.push(result);
        index
    })
}

#[derive(Default)]
struct BubbleGroup {
    count: u32,
    hovered: u8,
    selected_count: u32,
    sources: SmallVec<[u32; 8]>,
    y: f64,
}

#[unsafe(no_mangle)]
pub extern "C" fn bubble_results_clear() {
    SESSION.with_borrow_mut(|session| session.bubble_results.clear());
}

#[unsafe(no_mangle)]
pub extern "C" fn bubble_build(
    y_slot: u32,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    max_aggregates: u32,
    hover_source_index: i64,
) -> u32 {
    SESSION.with_borrow_mut(|session| {
        let y = match session.y.get(y_slot as usize) {
            Some(y) => y,
            None => return u32::MAX,
        };
        let (x_min, x_max) = ordered_range(x_min, x_max);
        let (y_min, y_max) = ordered_range(y_min, y_max);
        let (start, end) = scan_range(session, x_min, x_max);
        let budget = max_aggregates.max(1) as usize;
        let hashed = end - start > budget.saturating_mul(2);
        let mut result = BubbleResult::default();
        if hashed {
            build_bubble_hashed(
                session,
                y,
                start,
                end,
                y_min,
                y_max,
                budget,
                hover_source_index,
                &mut result,
            );
        } else {
            build_bubble_systematic(
                session,
                y,
                start,
                end,
                y_min,
                y_max,
                budget,
                hover_source_index,
                &mut result,
            );
        }
        let index = session.bubble_results.len() as u32;
        session.bubble_results.push(result);
        index
    })
}

fn build_bubble_hashed(
    session: &Session,
    y: &Column,
    start: usize,
    end: usize,
    y_min: f64,
    y_max: f64,
    budget: usize,
    hover: i64,
    result: &mut BubbleResult,
) {
    let regular_budget = budget.saturating_sub(1);
    let stride = if regular_budget == 0 {
        u32::MAX
    } else {
        (((end - start) as f64 / (regular_budget as f64 * 0.98)).ceil() as u32).max(1)
    };
    let mut largest: Option<(f64, BubbleGroup, bool)> = None;
    visit_groups(
        session,
        y,
        start,
        end,
        y_min,
        y_max,
        hover,
        true,
        |x, mut group| {
            let keep = result.center_x.len() < regular_budget
                && (stride == 1 || hash_coordinate(x, group.y).is_multiple_of(stride));
            if keep {
                append_group(result, x, &mut group);
            }
            if largest
                .as_ref()
                .is_none_or(|(_, current, _)| group.count > current.count)
            {
                largest = Some((x, group, keep));
            }
            result.total_aggregate_count += 1;
        },
    );
    if let Some((x, mut group, false)) = largest {
        append_group(result, x, &mut group);
        sort_bubble_result(result);
    }
}

fn build_bubble_systematic(
    session: &Session,
    y: &Column,
    start: usize,
    end: usize,
    y_min: f64,
    y_max: f64,
    budget: usize,
    hover: i64,
    result: &mut BubbleResult,
) {
    let mut total = 0usize;
    let mut largest_ordinal = usize::MAX;
    let mut largest_count = 0u32;
    visit_groups(
        session,
        y,
        start,
        end,
        y_min,
        y_max,
        hover,
        false,
        |_x, group| {
            if group.count > largest_count {
                largest_count = group.count;
                largest_ordinal = total;
            }
            total += 1;
        },
    );
    result.total_aggregate_count = total as u32;
    let reserve_largest = total > budget && largest_ordinal != usize::MAX;
    let regular_budget = if reserve_largest {
        budget.saturating_sub(1).max(1)
    } else {
        budget
    };
    let stride = ((total as f64 / regular_budget.max(1) as f64).ceil() as usize).max(1);
    let mut ordinal = 0usize;
    visit_groups(
        session,
        y,
        start,
        end,
        y_min,
        y_max,
        hover,
        true,
        |x, mut group| {
            let keep_largest = ordinal == largest_ordinal;
            let keep_regular =
                ordinal.is_multiple_of(stride) && result.center_x.len() < regular_budget;
            if keep_largest || keep_regular {
                append_group(result, x, &mut group);
            }
            ordinal += 1;
        },
    );
    sort_bubble_result(result);
}

fn visit_groups<F: FnMut(f64, BubbleGroup)>(
    session: &Session,
    y: &Column,
    start: usize,
    end: usize,
    y_min: f64,
    y_max: f64,
    hover: i64,
    collect_sources: bool,
    mut visitor: F,
) {
    let mut sorted = start;
    while sorted < end {
        let first_point = point_index_at(session, sorted);
        let x = session.x.read(first_point);
        if !x.is_finite() {
            sorted += 1;
            continue;
        }
        let mut run_end = sorted + 1;
        while run_end < end {
            let point = point_index_at(session, run_end);
            if session.x.read(point).to_bits() != x.to_bits() {
                break;
            }
            run_end += 1;
        }
        if run_end == sorted + 1 {
            let value = y.read(first_point);
            if value.is_finite() && value >= y_min && value <= y_max {
                let source = source_index_at(session, first_point);
                visitor(
                    x,
                    BubbleGroup {
                        count: 1,
                        hovered: (hover >= 0 && source == hover as u32) as u8,
                        selected_count: if session.selected_count > 0 {
                            selected_at(session, source)
                        } else {
                            0
                        },
                        sources: if collect_sources {
                            SmallVec::from_buf_and_len([source, 0, 0, 0, 0, 0, 0, 0], 1)
                        } else {
                            SmallVec::new()
                        },
                        y: value,
                    },
                );
            }
            sorted = run_end;
            continue;
        }
        let mut ordered: SmallVec<[BubbleGroup; 8]> = SmallVec::new();
        if run_end - sorted <= 8 {
            for run in sorted..run_end {
                let point = point_index_at(session, run);
                let value = y.read(point);
                if !value.is_finite() || value < y_min || value > y_max {
                    continue;
                }
                let source = source_index_at(session, point);
                let key = if value == 0.0 { 0 } else { value.to_bits() };
                let group_index = ordered
                    .iter()
                    .position(|group| (if group.y == 0.0 { 0 } else { group.y.to_bits() }) == key);
                if let Some(index) = group_index {
                    update_group(
                        unsafe { ordered.get_unchecked_mut(index) },
                        session,
                        source,
                        hover,
                        collect_sources,
                    );
                } else {
                    let mut group = BubbleGroup {
                        y: value,
                        ..BubbleGroup::default()
                    };
                    update_group(&mut group, session, source, hover, collect_sources);
                    ordered.push(group);
                }
            }
        } else {
            let mut groups: HashMap<u64, BubbleGroup> = HashMap::new();
            for run in sorted..run_end {
                let point = point_index_at(session, run);
                let value = y.read(point);
                if !value.is_finite() || value < y_min || value > y_max {
                    continue;
                }
                let source = source_index_at(session, point);
                let key = if value == 0.0 { 0 } else { value.to_bits() };
                let group = groups.entry(key).or_insert_with(|| BubbleGroup {
                    y: value,
                    ..BubbleGroup::default()
                });
                update_group(group, session, source, hover, collect_sources);
            }
            ordered.extend(groups.into_values());
        }
        ordered.sort_unstable_by(|left, right| {
            left.y.partial_cmp(&right.y).unwrap_or(Ordering::Equal)
        });
        for group in ordered {
            visitor(x, group);
        }
        sorted = run_end;
    }
}

#[inline(always)]
fn update_group(
    group: &mut BubbleGroup,
    session: &Session,
    source: u32,
    hover: i64,
    collect_sources: bool,
) {
    group.count += 1;
    if session.selected_count > 0 {
        group.selected_count += selected_at(session, source);
    }
    group.hovered |= (hover >= 0 && source == hover as u32) as u8;
    if collect_sources {
        group.sources.push(source);
    }
}

fn append_group(result: &mut BubbleResult, x: f64, group: &mut BubbleGroup) {
    group.sources.sort_unstable();
    result.center_x.push(x);
    result.center_y.push(group.y);
    result.counts.push(group.count);
    result.hovered.push(group.hovered);
    result
        .membership_offsets
        .push(result.source_indices.len() as u32);
    result.membership_counts.push(group.sources.len() as u32);
    result.selected_counts.push(group.selected_count);
    result.source_indices.extend(group.sources.drain(..));
    if group.count == 1 {
        result.singleton_count += 1;
    }
}

fn sort_bubble_result(result: &mut BubbleResult) {
    if result.center_x.len() < 2 {
        return;
    }
    let mut order: Vec<usize> = (0..result.center_x.len()).collect();
    order.sort_unstable_by(|&left, &right| {
        result.center_x[left]
            .partial_cmp(&result.center_x[right])
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                result.center_y[left]
                    .partial_cmp(&result.center_y[right])
                    .unwrap_or(Ordering::Equal)
            })
    });
    if order
        .iter()
        .enumerate()
        .all(|(index, &value)| index == value)
    {
        return;
    }
    let mut next = BubbleResult {
        total_aggregate_count: result.total_aggregate_count,
        ..BubbleResult::default()
    };
    for source in order {
        let offset = result.membership_offsets[source] as usize;
        let count = result.membership_counts[source] as usize;
        let mut group = BubbleGroup {
            count: result.counts[source],
            hovered: result.hovered[source],
            selected_count: result.selected_counts[source],
            sources: SmallVec::from_slice(&result.source_indices[offset..offset + count]),
            y: result.center_y[source],
        };
        append_group(&mut next, result.center_x[source], &mut group);
    }
    *result = next;
}

#[inline(always)]
fn point_index_at(session: &Session, sorted_index: usize) -> usize {
    session
        .x_order
        .as_ref()
        .map_or(sorted_index, |order| unsafe {
            *order.get_unchecked(sorted_index) as usize
        })
}

#[inline(always)]
fn source_index_at(session: &Session, point_index: usize) -> u32 {
    session
        .source_index
        .as_ref()
        .map_or(point_index as u32, |source| unsafe {
            *source.get_unchecked(point_index)
        })
}

#[inline(always)]
fn selected_at(session: &Session, source_index: u32) -> u32 {
    session
        .selected
        .get(source_index as usize)
        .copied()
        .unwrap_or(0) as u32
}

fn scan_range(session: &Session, min: f64, max: f64) -> (usize, usize) {
    let mut low = 0usize;
    let mut high = session.point_count;
    while low < high {
        let middle = (low + high) >> 1;
        if session.x.read(point_index_at(session, middle)) < min {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    let start = low;
    high = session.point_count;
    while low < high {
        let middle = (low + high) >> 1;
        if session.x.read(point_index_at(session, middle)) <= max {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    (start, low)
}

#[inline(always)]
fn ordered_range(left: f64, right: f64) -> (f64, f64) {
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

#[inline(always)]
fn heat_cell_scaled(
    x: f64,
    y: f64,
    x_min: f64,
    x_max: f64,
    y_min: f64,
    y_max: f64,
    x_scale: f64,
    y_scale: f64,
    x_bins: u32,
    y_bins: u32,
) -> usize {
    let x_bin = bin_index_scaled(x, x_min, x_max, x_scale, x_bins);
    let y_bin = bin_index_scaled(y, y_min, y_max, y_scale, y_bins);
    y_bin as usize * x_bins as usize + x_bin as usize
}

#[inline(always)]
fn bin_index_scaled(value: f64, min: f64, max: f64, scale: f64, count: u32) -> u32 {
    if count <= 1 || max <= min || value <= min {
        return 0;
    }
    if value >= max {
        return count - 1;
    }
    (((value - min) * scale).floor() as u32).min(count - 1)
}

#[inline(always)]
fn generated_overlap_x(index: usize) -> usize {
    let block = index / 24 * 24;
    match index - block {
        2..=4 => block + 2,
        14..=15 => block + 14,
        _ => index,
    }
}

fn hash_coordinate(x: f64, y: f64) -> u32 {
    let floor_x = x.floor();
    let floor_y = y.floor();
    let x_low = floor_x as i64 as u32;
    let y_low = floor_y as i64 as u32;
    let x_fraction = ((x - floor_x).abs() * 4_294_967_296.0).floor() as u32;
    let y_fraction = ((y - floor_y).abs() * 4_294_967_296.0).floor() as u32;
    let mut value = (x_low ^ x_fraction).wrapping_mul(0x9e37_79b1)
        ^ (y_low ^ y_fraction).wrapping_mul(0x85eb_ca6b);
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb_352d);
    value ^= value >> 15;
    value
}

macro_rules! accessor {
    ($ptr_name:ident, $len_name:ident, $results:ident, $field:ident) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $ptr_name(index: u32) -> u32 {
            SESSION.with_borrow(|session| {
                session
                    .$results
                    .get(index as usize)
                    .map_or(0, |value| value.$field.as_ptr() as u32)
            })
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn $len_name(index: u32) -> u32 {
            SESSION.with_borrow(|session| {
                session
                    .$results
                    .get(index as usize)
                    .map_or(0, |value| value.$field.len() as u32)
            })
        }
    };
}

accessor!(heat_counts_ptr, heat_counts_len, heat_results, counts);
accessor!(heat_hovered_ptr, heat_hovered_len, heat_results, hovered);
accessor!(
    heat_membership_counts_ptr,
    heat_membership_counts_len,
    heat_results,
    membership_counts
);
accessor!(
    heat_membership_offsets_ptr,
    heat_membership_offsets_len,
    heat_results,
    membership_offsets
);
accessor!(
    heat_selected_counts_ptr,
    heat_selected_counts_len,
    heat_results,
    selected_counts
);
accessor!(
    heat_source_indices_ptr,
    heat_source_indices_len,
    heat_results,
    source_indices
);
accessor!(
    bubble_center_x_ptr,
    bubble_center_x_len,
    bubble_results,
    center_x
);
accessor!(
    bubble_center_y_ptr,
    bubble_center_y_len,
    bubble_results,
    center_y
);
accessor!(bubble_counts_ptr, bubble_counts_len, bubble_results, counts);
accessor!(
    bubble_hovered_ptr,
    bubble_hovered_len,
    bubble_results,
    hovered
);
accessor!(
    bubble_membership_counts_ptr,
    bubble_membership_counts_len,
    bubble_results,
    membership_counts
);
accessor!(
    bubble_membership_offsets_ptr,
    bubble_membership_offsets_len,
    bubble_results,
    membership_offsets
);
accessor!(
    bubble_selected_counts_ptr,
    bubble_selected_counts_len,
    bubble_results,
    selected_counts
);
accessor!(
    bubble_source_indices_ptr,
    bubble_source_indices_len,
    bubble_results,
    source_indices
);

#[unsafe(no_mangle)]
pub extern "C" fn heat_populated_count(index: u32) -> u32 {
    SESSION.with_borrow(|session| {
        session
            .heat_results
            .get(index as usize)
            .map_or(0, |result| result.populated_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn heat_x_bin_count(index: u32) -> u32 {
    SESSION.with_borrow(|session| {
        session
            .heat_results
            .get(index as usize)
            .map_or(0, |result| result.x_bin_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn heat_y_bin_count(index: u32) -> u32 {
    SESSION.with_borrow(|session| {
        session
            .heat_results
            .get(index as usize)
            .map_or(0, |result| result.y_bin_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn bubble_singleton_count(index: u32) -> u32 {
    SESSION.with_borrow(|session| {
        session
            .bubble_results
            .get(index as usize)
            .map_or(0, |result| result.singleton_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn bubble_total_aggregate_count(index: u32) -> u32 {
    SESSION.with_borrow(|session| {
        session
            .bubble_results
            .get(index as usize)
            .map_or(0, |result| result.total_aggregate_count)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn session_resident_bytes() -> u32 {
    SESSION.with_borrow(|session| {
        let columns = session.x.bytes.capacity()
            + session
                .y
                .iter()
                .map(|value| value.bytes.capacity())
                .sum::<usize>();
        let order = session.x_order.as_ref().map_or(0, Vec::capacity) * 4;
        let source = session.source_index.as_ref().map_or(0, Vec::capacity) * 4;
        let selected = session.selected.capacity();
        let selection_input = session.selection_input.capacity() * 4;
        let heat = session
            .heat_results
            .iter()
            .map(|result| {
                (result.counts.capacity()
                    + result.membership_counts.capacity()
                    + result.membership_offsets.capacity()
                    + result.selected_counts.capacity()
                    + result.source_indices.capacity())
                    * 4
                    + result.hovered.capacity()
            })
            .sum::<usize>();
        let bubble = session
            .bubble_results
            .iter()
            .map(|result| {
                (result.center_x.capacity() + result.center_y.capacity()) * 8
                    + (result.counts.capacity()
                        + result.membership_counts.capacity()
                        + result.membership_offsets.capacity()
                        + result.selected_counts.capacity()
                        + result.source_indices.capacity())
                        * 4
                    + result.hovered.capacity()
            })
            .sum::<usize>();
        columns
            .saturating_add(order)
            .saturating_add(source)
            .saturating_add(selected)
            .saturating_add(selection_input)
            .saturating_add(heat)
            .saturating_add(bubble)
            .min(u32::MAX as usize) as u32
    })
}
