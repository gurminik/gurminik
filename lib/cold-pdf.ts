import {type ColdState,coldProducts,coldSummary} from './cold-storage.ts';

const ascii=(v:unknown)=>String(v??'').replace(/[çÇğĞıİöÖşŞüÜ]/g,c=>({ç:'c',Ç:'C',ğ:'g',Ğ:'G',ı:'i',İ:'I',ö:'o',Ö:'O',ş:'s',Ş:'S',ü:'u',Ü:'U'}[c]||c)).replace(/[^\x20-\x7e]/g,'?').replace(/([\\()])/g,'\\$1');
const amount=(n:number)=>new Intl.NumberFormat('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0)+' TL';
const kilos=(n:number)=>new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2}).format(n||0)+' kg';
export function createColdPdf(state:ColdState,start=-Infinity,end=Infinity,label='Tüm zamanlar'){
  const pages:string[][]=[[]];let page=0,y=520;
  const write=(x:number,z:number,size:number,value:unknown,bold=false,white=false)=>pages[page].push(`BT /F${bold?2:1} ${size} Tf ${white?'1 1 1':'0.1 0.1 0.1'} rg ${x} ${z} Td (${ascii(value)}) Tj ET`);
  const rect=(x:number,z:number,w:number,h:number,r:number)=>pages[page].push(`${r} ${r} ${r} rg ${x} ${z} ${w} ${h} re f`);
  const head=()=>{rect(0,538,842,57,.12);write(30,568,16,'GURMINIK  /  SOGUK HAVA DEPOSU',true,true);write(30,549,9,label,false,true)};
  const next=()=>{page++;pages.push([]);y=520;head()};
  const ensure=(height:number)=>{if(y-height<42)next()};
  const section=(name:string)=>{ensure(80);y-=19;rect(30,y-6,782,25,.91);write(40,y+1,11,name,true);y-=26};
  const line=(label:string,value:unknown)=>{ensure(22);write(38,y,9,label);write(430,y,9,value,true);y-=20};
  const grid=(headers:string[],widths:number[],records:string[][])=>{const tableHead=()=>{ensure(39);rect(30,y-17,782,22,.2);let x=38;headers.forEach((h,i)=>{write(x,y-10,8,h,true,true);x+=widths[i]});y-=23};tableHead();for(const [index,row] of records.entries()){if(y<58){next();tableHead()}if(index%2)rect(30,y-18,782,21,.96);let x=38;row.forEach((v,i)=>{const max=Math.max(5,Math.floor((widths[i]-10)/4));write(x,y-11,8,v.length>max?v.slice(0,max-3)+'...':v);x+=widths[i]});y-=21}y-=9};
  head();const sum=coldSummary(state,start,end);
  section('ALIS OZETI');line('Toplam alis KG',kilos(sum.buyKg));line('Toplam alis tutari',amount(sum.buyCost));line('Agirlikli ortalama alis TL/KG',amount(sum.averageBuy));
  section('SATIS OZETI');line('Toplam satis KG',kilos(sum.saleKg));line('Toplam satis tutari',amount(sum.revenue));line('Agirlikli ortalama satis TL/KG',amount(sum.averageSale));
  section('GIDER OZETI');const costs=state.expenses.filter(x=>{const t=new Date(x.dateTime).getTime();return t>=start&&t<end});for(const cat of [...new Set(costs.map(x=>x.category))])line(cat,amount(costs.filter(x=>x.category===cat).reduce((a,x)=>a+x.amount,0)));line('TOPLAM DEPO GIDERI',amount(sum.expenses));
  section('STOK VE GERCEKLESMIS KAR');line('Mevcut stok (donem sonu)',kilos(sum.stockKg));line('Satilan mal maliyeti',amount(sum.costOfGoods));line('Gerceklesmis kar',amount(sum.profit));line('KG basina kar',amount(sum.profitPerKg));
  section('URUN BAZLI DAGILIM');grid(['Urun','Alis KG','Satis KG','Stok KG','Alis TL','Satis TL','Kar TL'],[135,100,100,100,112,112,123],coldProducts(state).map(name=>{const s=coldSummary(state,start,end,name);return[name,kilos(s.buyKg),kilos(s.saleKg),kilos(s.stockKg),amount(s.buyCost),amount(s.revenue),amount(s.profit)]}));
  section('ALIS HAREKETLERI');grid(['Tarih','Urun','Tedarikci','Plaka','KG','TL/KG','Tutar'],[105,105,140,115,86,96,135],state.purchases.filter(x=>{const t=new Date(x.dateTime).getTime();return t>=start&&t<end}).map(x=>[new Date(x.dateTime).toLocaleDateString('tr-TR'),x.product,x.person,x.plate,kilos(x.kg),amount(x.price),amount(x.kg*x.price)]));
  section('SATIS HAREKETLERI');grid(['Tarih','Urun','Alici','KG','TL/KG','Tutar'],[120,125,165,110,120,142],state.sales.filter(x=>{const t=new Date(x.dateTime).getTime();return t>=start&&t<end}).map(x=>[new Date(x.dateTime).toLocaleDateString('tr-TR'),x.product,x.buyer,kilos(x.kg),amount(x.price),amount(x.kg*x.price)]));
  pages.forEach((p,i)=>p.push(`BT /F1 8 Tf 30 20 Td (Sayfa ${i+1} / ${pages.length}  |  Giderler satilan KG payina gore dagitilir; stok donem sonu bakiyesidir.) Tj ET`));
  const objects:Record<number,string>={1:'<< /Type /Catalog /Pages 2 0 R >>',3:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',4:'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'};
  const ids:string[]=[];pages.forEach((commands,i)=>{const n=5+i*2,stream=commands.join('\n');ids.push(`${n} 0 R`);objects[n]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${n+1} 0 R >>`;objects[n+1]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`});objects[2]=`<< /Type /Pages /Kids [${ids.join(' ')}] /Count ${pages.length} >>`;
  let pdf='%PDF-1.4\n';const positions=[0],max=Math.max(...Object.keys(objects).map(Number));for(let i=1;i<=max;i++){positions[i]=pdf.length;pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`}const offset=pdf.length;pdf+=`xref\n0 ${max+1}\n0000000000 65535 f \n`;for(let i=1;i<=max;i++)pdf+=String(positions[i]).padStart(10,'0')+' 00000 n \n';return pdf+`trailer\n<< /Size ${max+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;
}
