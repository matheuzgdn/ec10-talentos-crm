type CampaignClient={bot_instance_id?:string;bot_paused?:boolean;tags?:string[];traffic_source?:string|null;attribution_metadata?:Record<string,unknown>|null};
export function campaignSdrSince(){
 const raw=process.env.EC10_CAMPAIGN_SDR_SINCE||'';
 return Number.isFinite(Date.parse(raw))?new Date(raw).toISOString():null;
}
export function isNewCampaignLead(client:CampaignClient|null|undefined,since=campaignSdrSince(),now=Date.now()){
 if(!client||!since||client.bot_instance_id!=='main'||client.bot_paused)return false;
 if((client.tags||[]).some(t=>/opt.?out|nao_contatar|bloqueado|ia_transferencia_humana/.test(t)))return false;
 const m=client.attribution_metadata;
 if(!m||m.funnelKey!=='ec10_campaign_landing_pages'||client.traffic_source!=='ec10_campaign_lp')return false;
 const captured=Date.parse(String(m.capturedAt||''));const start=Date.parse(since);
 return Number.isFinite(start)&&Number.isFinite(captured)&&captured>=start&&captured<=now+60000;
}
