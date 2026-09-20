export async function fetchAllRows<T>(query:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:Error|null}>):Promise<{data:T[];error:Error|null}>{
  const rows:T[]=[];
  for(let from=0;;from+=700){
    const {data,error}=await query(from,from+699);
    if(error)return{data:[],error};
    rows.push(...(data||[]));
    if(!data||data.length<700)return{data:rows,error:null};
  }
}
