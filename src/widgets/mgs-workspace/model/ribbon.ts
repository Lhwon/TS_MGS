/**
 * 파일명: ribbon.ts
 * 설명: 원본 MainWindow 화면의 표시 탭과 그룹 및 명령 순서
 * 작성자: 이희원
 * 작성일자: 2026-10-23
 */
interface RibbonCommand {
  id: string
  label: string
  toggle: boolean
  width: number
}

interface RibbonGroup {
  name: string
  buttons: readonly RibbonCommand[]
  columns?: number
  selector?: 'portType'
}

export const MGS_RIBBON: readonly { name: string; groups: readonly RibbonGroup[] }[] = [
  {
    name: 'File',
    groups: [
      {
        name: '',
        buttons: [
          {
            id: 'BT_open_file',
            label: 'Map Open',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_save_file',
            label: 'Map Save',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_show_report',
            label: 'Map Report',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_select_project',
            label: 'Project Select',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_load_layout',
            label: 'Layout Load',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_init_project',
            label: 'Clear All Data',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_save_jmapx',
            label: 'Save\nOnly Map',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_apply_xlsx',
            label: 'Apply\nTeaching',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_open_project_folder',
            label: 'Project\nFolder\nOpen',
            toggle: false,
            width: 80,
          },
          { id: 'TS_save_as', label: 'Save As', toggle: false, width: 80 },
        ],
      },
    ],
  },
  {
    name: 'View',
    groups: [
      {
        name: 'Node',
        columns: 3,
        buttons: [
          {
            id: 'TBT_show_real_id',
            label: 'Real ID',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_node_id',
            label: 'Node ID',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_unique_id',
            label: 'Unique ID',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_virtual_node',
            label: 'Virtual',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_position',
            label: 'Position',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_property',
            label: 'Property',
            toggle: true,
            width: 70,
          },
        ],
      },
      {
        name: 'Node Setting',
        columns: 2,
        buttons: [
          {
            id: 'TBT_show_no_send_goal',
            label: 'No Send Goal',
            toggle: true,
            width: 100,
          },
          {
            id: 'TBT_show_no_send_goal_loaded',
            label: 'No Send Goal (Loaded)',
            toggle: true,
            width: 150,
          },
          {
            id: 'TBT_show_address_type',
            label: 'Address Type',
            toggle: true,
            width: 100,
          },
          {
            id: 'TBT_show_dont_remove_cmd',
            label: 'Don`t Remove CMD',
            toggle: true,
            width: 150,
          },
        ],
      },
      {
        name: 'Direction / Distance',
        columns: 2,
        buttons: [
          {
            id: 'TBT_show_direction',
            label: 'Path',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_node_dir',
            label: 'Node',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_vhl_dir',
            label: 'Vehicle Dir.',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_distance',
            label: 'Distance',
            toggle: true,
            width: 70,
          },
        ],
      },
      {
        name: 'Curve',
        columns: 1,
        buttons: [
          {
            id: 'TBT_show_curve_type',
            label: 'Type',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_radius',
            label: 'Radius',
            toggle: true,
            width: 70,
          },
        ],
      },
      {
        name: 'Path Basic Setting',
        columns: 5,
        buttons: [
          {
            id: 'TBT_show_vhl_speed',
            label: 'Speed',
            toggle: true,
            width: 80,
          },
          {
            id: 'TBT_show_reverse',
            label: 'Reverse',
            toggle: true,
            width: 95,
          },
          {
            id: 'TBT_show_manual_deg',
            label: 'Manual Degree',
            toggle: true,
            width: 95,
          },
          {
            id: 'TBT_show_ods_field',
            label: 'ODS Field',
            toggle: true,
            width: 95,
          },
          {
            id: 'TBT_show_path_weight',
            label: 'Weight',
            toggle: true,
            width: 80,
          },
          {
            id: 'TBT_show_spinturnable',
            label: 'Spinturnable',
            toggle: true,
            width: 95,
          },
          {
            id: 'TBT_show_guidance_type',
            label: 'Guidance Type',
            toggle: true,
            width: 95,
          },
          {
            id: 'TBT_show_control_weight',
            label: 'Control Weight',
            toggle: true,
            width: 95,
          },
          {
            id: 'TBT_show_meandev_ignore',
            label: 'Meandev Ignore',
            toggle: true,
            width: 95,
          },
        ],
      },
      { name: 'Port Type', selector: 'portType', buttons: [] },
      {
        name: 'Port Name',
        columns: 2,
        buttons: [
          {
            id: 'TBT_show_port_name',
            label: 'Name',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_port_id',
            label: 'ID',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_report_id',
            label: 'Report ID',
            toggle: true,
            width: 70,
          },
        ],
      },
      {
        name: 'Port Setting',
        columns: 2,
        buttons: [
          {
            id: 'TBT_show_lu_shift',
            label: 'LU Shift',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_handshaking',
            label: 'PIO Type',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_lu_direction',
            label: 'LU Dir.',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_lu_height',
            label: 'LU Height',
            toggle: true,
            width: 70,
          },
        ],
      },
      {
        name: 'ETC.',
        columns: 2,
        buttons: [
          {
            id: 'TBT_show_port_idx',
            label: 'Port Index',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_font_style',
            label: 'Node\nHighlight',
            toggle: true,
            width: 70,
          },
          {
            id: 'TBT_show_port_caption',
            label: 'Caption',
            toggle: true,
            width: 70,
          },
        ],
      },
    ],
  },
  {
    name: 'Drawing',
    groups: [
      {
        name: '',
        buttons: [
          {
            id: 'BT_right_angle',
            label: ' [A] \n Right Angle \n Auto Change',
            toggle: true,
            width: 100,
          },
          {
            id: 'BT_x_magnet',
            label: '[X] X Magnet',
            toggle: true,
            width: 90,
          },
          {
            id: 'BT_y_magnet',
            label: '[Y] Y Magnet',
            toggle: true,
            width: 90,
          },
          {
            id: 'BT_auto_straight_curve',
            label: ' Straight / Curve \n Auto Select',
            toggle: true,
            width: 120,
          },
          {
            id: 'BT_force_curve',
            label: '[F]\nPush : Force Curve \nElse : according option',
            toggle: true,
            width: 150,
          },
          {
            id: 'BT_curve_reverse',
            label: '[R]\nCurve\nReverse',
            toggle: true,
            width: 100,
          },
          {
            id: 'BT_dynamic_radius',
            label: 'Dynamic\nRadius',
            toggle: true,
            width: 100,
          },
          {
            id: 'BT_select_pre_node',
            label: 'Previous Node\nAuto Selection',
            toggle: true,
            width: 100,
          },
          {
            id: 'BT_check_overlab',
            label: 'Check Node\nOverlap',
            toggle: true,
            width: 100,
          },
          {
            id: 'BT_setting_curve',
            label: 'Curve\nSetting',
            toggle: false,
            width: 100,
          },
          {
            id: 'BT_setting_draw',
            label: 'Driving Type\nDraw Style',
            toggle: true,
            width: 100,
          },
          {
            id: 'TBT_force_delete_cv_start',
            label: 'Curve\nStart Node\nForce Delete',
            toggle: true,
            width: 120,
          },
          {
            id: 'TBT_auto_reverse_orthogonal',
            label: 'Auto Reverse\nOrthogonal',
            toggle: true,
            width: 120,
          },
          {
            id: 'TBT_check_auto_conn',
            label: 'Check\nAuto Connect\nwhen deleting',
            toggle: true,
            width: 120,
          },
          {
            id: 'TBT_stop_rendering',
            label: 'Stop Rendering\nfor Delete Nodes',
            toggle: true,
            width: 120,
          },
        ],
      },
    ],
  },
  {
    name: 'Data',
    groups: [
      {
        name: 'Bay',
        buttons: [
          {
            id: 'BT_area',
            label: 'Bay and\nZone',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_bay_offset',
            label: 'Bay Offset',
            toggle: false,
            width: 80,
          },
        ],
      },
      {
        name: 'ACS Operation Data',
        buttons: [
          {
            id: 'BT_pre_occupation_setting',
            label: 'Pre\nOccupation',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_make_command_list',
            label: 'Make\nCommand',
            toggle: false,
            width: 80,
          },
        ],
      },
      {
        name: 'Schedule Command Setting',
        buttons: [
          {
            id: 'BT_scmd_item_setting',
            label: 'SCMD\nItem',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_schedule_list_setting',
            label: 'SCMD\nGroup',
            toggle: false,
            width: 80,
          },
        ],
      },
      {
        name: 'ACS Advanced Function',
        buttons: [
          {
            id: 'BT_vhl_limited_area',
            label: 'Vehicle\nLimited Area',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_path_distance',
            label: 'Path \nDistance',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_limit_ports',
            label: 'Limit Ports',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_control_map_data',
            label: 'Map Data\nControl',
            toggle: false,
            width: 80,
          },
        ],
      },
      {
        name: 'Map Data',
        buttons: [
          {
            id: 'BT_node_ban_setting',
            label: 'Node Ban\nSetting',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_search_illegal_node',
            label: 'Check\nIllegal Node',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_illegal_port',
            label: 'Check\nIllegal Port',
            toggle: false,
            width: 80,
          },
        ],
      },
    ],
  },
  {
    name: 'Vehicle',
    groups: [
      {
        name: 'Contour',
        buttons: [
          {
            id: 'BT_agv_type',
            label: 'AGV Type\nSetting',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_carrier_setting',
            label: 'Carrier\nSetting',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_contour_setting',
            label: 'Contour\nSetting',
            toggle: false,
            width: 80,
          },
        ],
      },
      {
        name: 'Control Solution™',
        buttons: [
          {
            id: 'BT_ods_setting',
            label: 'ODS\nSetting',
            toggle: false,
            width: 80,
          },
        ],
      },
    ],
  },
  {
    name: 'Shape',
    groups: [
      {
        name: '',
        buttons: [
          {
            id: 'TBT_shape_line',
            label: 'Line',
            toggle: true,
            width: 80,
          },
          {
            id: 'TBT_shape_rectangle',
            label: 'Rectangle',
            toggle: true,
            width: 80,
          },
          {
            id: 'TBT_shape_round_rectangle',
            label: 'Round Rect',
            toggle: true,
            width: 80,
          },
          {
            id: 'TBT_shape_circle',
            label: 'Circle',
            toggle: true,
            width: 80,
          },
          {
            id: 'TBT_shape_ellipse',
            label: 'Ellipse',
            toggle: true,
            width: 80,
          },
          {
            id: 'TBT_shape_text',
            label: 'Text',
            toggle: true,
            width: 80,
          },
        ],
      },
    ],
  },
  {
    name: 'Setting',
    groups: [
      {
        name: '',
        buttons: [
          {
            id: 'BT_select_theme',
            label: 'Theme\nSetting',
            toggle: false,
            width: 80,
          },
        ],
      },
      {
        name: 'Prepared Theme',
        buttons: [
          {
            id: 'BT_set_theme_Office2010Blue',
            label: 'Blue',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_set_theme_Office2010Black',
            label: 'Dark',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_set_theme_Office2010Silver',
            label: 'Silver',
            toggle: false,
            width: 80,
          },
        ],
      },
    ],
  },
  {
    name: 'GRID',
    groups: [
      {
        name: '',
        buttons: [
          {
            id: 'TBT_show_grid',
            label: 'Show GRID',
            toggle: true,
            width: 80,
          },
          {
            id: 'BT_setting_grid',
            label: 'Setting Grid',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_make_grid',
            label: 'Make Grid',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_set_port_color',
            label: 'Set Port\nColor',
            toggle: false,
            width: 80,
          },
        ],
      },
    ],
  },
  {
    name: 'Expert / Developer',
    groups: [
      {
        name: '',
        buttons: [
          {
            id: 'BT_apply_db_data',
            label: 'Apply\nDB Data',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_clear_manual_deg',
            label: 'Clear\nManual Deg',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_clear_correct_deg',
            label: 'Clear\nCorrect Deg',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_reverse_reverse',
            label: 'Reverse\nReverse',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_create_uid',
            label: 'Create UID',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_clear_property',
            label: 'Clear\nproperty',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_clear_path_index',
            label: 'Clear\npath index',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_set_real_id_in_area',
            label: 'Set Real ID\nIn Area',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_make_lot_dist',
            label: 'Make LOT\nCloser',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_capture_minimap',
            label: 'Mini-Map\nCapture',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_check_closer_node',
            label: 'Check Closer\nNode',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_show_ic_jc',
            label: 'Show\nIC / JC',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_show_except_po_node',
            label: 'Show Except\nOccupation',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_verify_aes_data_quick',
            label: 'Verify\nAES Data',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_clear_address_type',
            label: 'Clear\nAddress\nType',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_clear_no_send_goal_loaded',
            label: 'Clear\nNo\nSend Goal\n(Loaded)',
            toggle: false,
            width: 80,
          },
          {
            id: 'BT_make_dpp_test',
            label: 'Make DPP',
            toggle: false,
            width: 80,
          },
        ],
      },
    ],
  },
] as const
