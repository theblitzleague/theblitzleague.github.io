/* Plain-English names for the League's scoring stats (Sleeper stat keys), shared by the commissioner's scoring editor
   (js/scoring-admin.js) and the scoring change log on the Rules page (js/rules.js). */
export const GROUPS = [
  ['Passing', /^(pass_|bonus_pass)/], ['Rushing', /^(rush_|bonus_rush_(yd|att|td)|bonus_fd_rb)/], ['Receiving', /^(rec|bonus_rec|bonus_rush_rec|bonus_fd_(wr|te))/],
  ['Kicking', /^(fg|xp)/], ['Individual defensive players', /^(idp_|bonus_(tkl|sack|def_))/],
  ['Ball security and special teams', /^(fum|st_|def_st_|blk_kick|kr_yd|pr_yd|fg_ret|int_ret|bonus_fd_qb)/],
  ['Team defense (not used: no team defense slot)', /./],
];
const NAMES = {
  pass_yd: 'Passing yards (per yard)', pass_td: 'Passing touchdown', pass_int: 'Interception thrown', pass_int_td: 'Interception returned for a TD',
  pass_2pt: 'Two-point pass', pass_td_40p: 'TD pass of 40+ yards (bonus)', pass_td_50p: 'TD pass of 50+ yards (bonus)', bonus_pass_yd_300: '300+ passing yards (bonus)',
  bonus_pass_yd_400: '400+ passing yards (bonus)', pass_cmp: 'Completion', pass_att: 'Pass attempt', pass_inc: 'Incompletion', pass_sack: 'Sacked', pass_fd: 'Passing first down',
  bonus_pass_cmp_25: '25+ completions (bonus)', pass_cmp_40p: 'Completion of 40+ yards',
  rush_yd: 'Rushing yards (per yard)', rush_td: 'Rushing touchdown', rush_2pt: 'Two-point run', rush_td_40p: 'Rushing TD of 40+ yards (bonus)', rush_td_50p: 'Rushing TD of 50+ yards (bonus)',
  bonus_rush_yd_100: '100+ rushing yards (bonus)', bonus_rush_yd_200: '200+ rushing yards (bonus)', rush_att: 'Rush attempt', rush_fd: 'Rushing first down', rush_40p: 'Run of 40+ yards',
  bonus_rush_att_20: '20+ carries (bonus)', bonus_rush_td_qb: 'QB rushing TD (bonus)', bonus_fd_rb: 'RB first down (bonus)',
  rec: 'Reception', bonus_rec_te: 'Tight end reception (bonus)', bonus_rec_wr: 'Wide receiver reception (bonus)', bonus_rec_rb: 'Running back reception (bonus)',
  rec_yd: 'Receiving yards (per yard)', rec_td: 'Receiving touchdown', rec_2pt: 'Two-point catch', rec_td_40p: 'Receiving TD of 40+ yards (bonus)', rec_td_50p: 'Receiving TD of 50+ yards (bonus)',
  bonus_rec_yd_100: '100+ receiving yards (bonus)', bonus_rec_yd_200: '200+ receiving yards (bonus)', rec_fd: 'Receiving first down', rec_40p: 'Catch of 40+ yards',
  bonus_rush_rec_yd_100: '100+ rushing + receiving yards (bonus)', bonus_rush_rec_yd_200: '200+ rushing + receiving yards (bonus)',
  fgm_0_19: 'Field goal, 0-19 yards', fgm_20_29: 'Field goal, 20-29 yards', fgm_30_39: 'Field goal, 30-39 yards', fgm_40_49: 'Field goal, 40-49 yards', fgm_50_59: 'Field goal, 50-59 yards',
  fgm_50p: 'Field goal, 50+ yards', fgm_60p: 'Field goal of 60+ yards (bonus)', fgmiss: 'Field goal missed', xpm: 'Extra point made', xpmiss: 'Extra point missed', fgm: 'Field goal made (any)',
  fgm_yds: 'Field goal yards (per yard)', fgm_yds_over_30: 'Field goal yards over 30 (per yard)',
  idp_tkl: 'Tackle, solo or assisted', idp_tkl_solo: 'Solo tackle (extra)', idp_tkl_ast: 'Assisted tackle (extra)', idp_tkl_loss: 'Tackle for loss', bonus_tkl_10p: '10+ tackles (bonus)',
  idp_sack: 'Sack', bonus_sack_2p: '2+ sacks (bonus)', idp_qb_hit: 'Quarterback hit', idp_int: 'Interception', idp_pass_def: 'Pass defended', idp_pass_def_3p: '3+ passes defended (bonus)',
  idp_ff: 'Forced fumble', idp_fum_rec: 'Fumble recovery', idp_def_td: 'Defensive touchdown', bonus_def_int_td_50p: 'Interception return TD of 50+ yards (bonus)',
  bonus_def_fum_td_50p: 'Fumble return TD of 50+ yards (bonus)', idp_safe: 'Safety', idp_blk_kick: 'Blocked kick', idp_sack_yd: 'Sack yards (per yard)',
  fum_lost: 'Fumble lost', fum: 'Fumble (lost or not)', fum_rec: 'Fumble recovered', fum_rec_td: 'Fumble recovered for a TD', st_td: 'Special teams touchdown',
  st_ff: 'Special teams forced fumble', st_fum_rec: 'Special teams fumble recovery', def_st_td: 'Special teams TD (defense)', def_st_ff: 'Special teams forced fumble (defense)',
  def_st_fum_rec: 'Special teams fumble recovery (defense)', blk_kick: 'Blocked kick (team)', st_tkl_solo: 'Special teams solo tackle', def_st_tkl_solo: 'Special teams solo tackle (defense)',
};
Object.assign(NAMES, { def_td: 'Defensive TD (team)', ff: 'Forced fumble (team)', int: 'Interception (team)', sack: 'Sack (team)', safe: 'Safety (team)', pts_allow_0: 'Points allowed: 0' });
const range = (k, what) => { const m = k.match(/_(\d+)(?:_(\d+)|p)$/); return m ? `${what}: ${m[1]}${m[2] ? '-' + m[2] : '+'}` : null; };
export const label = k => NAMES[k] || (/^pts_allow_/.test(k) && range(k, 'Points allowed')) || (/^yds_allow_/.test(k) && range(k, 'Yards allowed')) || k.replace(/_/g, ' ').replace(/\b(\d+)p\b/g, '$1+').replace(/^./, c => c.toUpperCase());
export const groupOf = k => GROUPS.findIndex(([, re]) => re.test(k));

