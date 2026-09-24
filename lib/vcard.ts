export type ParsedVCardContact={
  id:string;
  name:string;
  phone:string;
  phoneKey:string;
  unnamed:boolean;
};

export type VCardParseResult={
  contacts:ParsedVCardContact[];
  invalid:number;
  duplicatesInFile:number;
  cards:number;
};

const decoderLabel=(value:string)=>{
  const label=value.trim().replace(/["']/g,"").toLowerCase();
  if(label.includes("1254")||label.includes("8859-9"))return "windows-1254";
  return "utf-8";
};

function decodeQuotedPrintable(value:string,charset:string){
  const bytes:number[]=[];
  for(let i=0;i<value.length;){
    if(value[i]==="="&&/^[0-9a-f]{2}$/i.test(value.slice(i+1,i+3))){bytes.push(Number.parseInt(value.slice(i+1,i+3),16));i+=3;continue}
    const encoded=new TextEncoder().encode(value[i]);bytes.push(...encoded);i++;
  }
  try{return new TextDecoder(decoderLabel(charset)).decode(new Uint8Array(bytes))}catch{return new TextDecoder().decode(new Uint8Array(bytes))}
}

function unescapeVCard(value:string){
  return value.replace(/\\[nN]/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\:/g,":").replace(/\\\\/g,"\\").trim();
}

function splitEscaped(value:string,separator:string){
  const parts:string[]=[];let current="",escaped=false;
  for(const char of value){
    if(escaped){current+="\\"+char;escaped=false;continue}
    if(char==="\\"){escaped=true;continue}
    if(char===separator){parts.push(current);current="";continue}
    current+=char;
  }
  if(escaped)current+="\\";parts.push(current);return parts;
}

function splitProperty(line:string){
  let quoted=false,escaped=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(escaped){escaped=false;continue}
    if(char==="\\"){escaped=true;continue}
    if(char==='"')quoted=!quoted;
    if(char===":"&&!quoted)return [line.slice(0,i),line.slice(i+1)] as const;
  }
  return null;
}

function propertyValue(header:string,value:string,unescape=true){
  const charset=header.match(/(?:^|;)CHARSET=([^;:]+)/i)?.[1]||"utf-8";
  const decoded=/(?:^|;)ENCODING=QUOTED-PRINTABLE(?:;|$)/i.test(header)?decodeQuotedPrintable(value,charset):value;
  return unescape?unescapeVCard(decoded):decoded.trim();
}

export function normalizePhone(value:string){
  let digits=value.replace(/^\s*tel:/i,"").split(";")[0].replace(/\D/g,"");
  if(/^0090\d{10}$/.test(digits))digits=digits.slice(2);
  else if(/^0\d{10}$/.test(digits))digits="90"+digits.slice(1);
  else if(/^\d{10}$/.test(digits))digits="90"+digits;
  if(!/^\d{7,15}$/.test(digits))return "";
  return digits;
}

export function formatPhone(value:string){
  const key=normalizePhone(value);
  if(!key)return value.trim();
  if(/^90\d{10}$/.test(key))return `+90 ${key.slice(2,5)} ${key.slice(5,8)} ${key.slice(8,10)} ${key.slice(10,12)}`;
  return `+${key}`;
}

export function decodeVCardBuffer(buffer:ArrayBuffer){
  const bytes=new Uint8Array(buffer);
  if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder("utf-16le").decode(buffer);
  if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder("utf-16be").decode(buffer);
  try{return new TextDecoder("utf-8",{fatal:true}).decode(buffer)}
  catch{try{return new TextDecoder("windows-1254").decode(buffer)}catch{return new TextDecoder().decode(buffer)}}
}

export function parseVCard(source:string):VCardParseResult{
  const normalized=source.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").replace(/=\n(?=[^\s])/g,"");
  const physical=normalized.split("\n"),lines:string[]=[];
  for(const line of physical){
    if(/^[ \t]/.test(line)&&lines.length)lines[lines.length-1]+=line.slice(1);
    else lines.push(line);
  }
  const blocks:string[][]=[];let card:string[]|null=null;
  for(const line of lines){
    if(/^BEGIN:VCARD\s*$/i.test(line)){card=[];continue}
    if(/^END:VCARD\s*$/i.test(line)){if(card)blocks.push(card);card=null;continue}
    if(card)card.push(line);
  }

  const contacts:ParsedVCardContact[]=[],seen=new Set<string>();let invalid=0,duplicatesInFile=0;
  blocks.forEach((block,cardIndex)=>{
    let formattedName="",structuredName="";const phones:string[]=[];
    for(const line of block){
      const pair=splitProperty(line);if(!pair)continue;
      const [header,rawValue]=pair,base=(header.split(";",1)[0].split(".").pop()||"").toUpperCase();
      if(base==="FN")formattedName=propertyValue(header,rawValue);
      else if(base==="N")structuredName=propertyValue(header,rawValue,false);
      else if(base==="TEL")phones.push(propertyValue(header,rawValue).replace(/^tel:/i,"").split(";")[0]);
    }
    if(!formattedName&&structuredName){
      const n=splitEscaped(structuredName,";").map(unescapeVCard);
      formattedName=[n[3],n[1],n[2],n[0],n[4]].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
    }
    if(!phones.length){invalid++;return}
    phones.forEach((rawPhone,phoneIndex)=>{
      const phoneKey=normalizePhone(rawPhone);
      if(!phoneKey){invalid++;return}
      if(seen.has(phoneKey)){duplicatesInFile++;return}
      seen.add(phoneKey);
      contacts.push({id:`vcard-${cardIndex}-${phoneIndex}-${phoneKey}`,name:formattedName||"İsimsiz kişi",phone:formatPhone(rawPhone),phoneKey,unnamed:!formattedName});
    });
  });
  return{contacts,invalid,duplicatesInFile,cards:blocks.length};
}
