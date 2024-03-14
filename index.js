import { read_cwa } from "./cwa.js";

let options = {
    hour: 'numeric', // Numeric hour
    minute: 'numeric', // Numeric minute
    second: 'numeric', // Numeric second
    fractionalSecondDigits: 3 // Number of digits after the decimal point in the seconds
};

document.getElementById("cwa_file").addEventListener("change",(event)=>{
    console.log(event.target.value)
    console.log(event.target.files[0])
    let url = URL.createObjectURL(event.target.files[0])
    try {
        read_cwa(url,{buffers:10000})
    } catch (error) {
        console.error(error)
    }
    URL.revokeObjectURL(url);
});

document.getElementById("cwa_5sec").addEventListener("change",async (event)=>{
    console.log(event.target.value)
    console.log(event.target.files[0])
    let url = URL.createObjectURL(event.target.files[0])
    try {
        console.log(test_callback())
        let r = await read_cwa(url,{buffers:20000,callback:test_callback()})
        buildTable(r,"five_sec_table")
    } catch (error) {
        console.error(error)
    }
    console.log("revoking url")
    event.target.value=""
    URL.revokeObjectURL(url);
});

function buildTable(dta,id){
    console.log(dta)
    let tableEl = document.getElementById(id)
    tableEl.innerText=""
    // only the first 100 rows...
    let x= (dta.data.length>100)?dta.data.slice(0,100):dta.data
    let row=tableEl.insertRow()
    // we want time, Ax, Ay, Az columns...
    let cols = ["time",'<span style="text-decoration:overline;">A</span><sub>x</sub>',
    '<span style="text-decoration:overline;">A</span><sub>y</sub>',
    '<span style="text-decoration:overline;">A</span><sub>z</sub>']
    cols.forEach((x)=>{
        let cell=row.insertCell();
        cell.outerHTML=`<th ">${x}</th>`
    })

    x.forEach((row_data) =>{
        row = tableEl.insertRow()
        let cell = row.insertCell()
        cell.innerText = (new Date(row_data.mid_time)).toLocaleString('en-US',options)
        cols = ["x_bar","y_bar","z_bar"]
        cols.forEach(col => {
            cell=row.insertCell()
            cell.innerText = row_data[col].toFixed(4)
        })
    })
}

/**
 * This function returns a callback function that takes a data_block,
 * (and Array of results {x,y,z and time} and averages the values over a
 * five-second block
 * 
 * @returns callback function.
 */
function test_callback(){
    let start_time = null;

    let sum = {
        x:0,
        y:0,
        z:0,
        n:0
    }

    return function(data_block){
        let return_value = []

        // special case when we hit the end-of-file...
        // return the current state, but be careful
        // we may have just returned a value...
        if (!data_block){
            if (sum.n != 0) {
                return_value.push({
                    mid_time: start_time + 2500,
                    x_bar: sum.x / sum.n,
                    y_bar: sum.y / sum.n,
                    z_bar: sum.z / sum.n,
                    n: sum.n
                })
            }else{
                return_value.push({ n:0,x_bar:0,y_bar:0,z_bar:0 })
            }
        }
    
        // time is measured in milliseconds.
        start_time = start_time || data_block[0].time
        for (const data_row of data_block ){
            // we have not hit 5 seconds ...
            if (data_row.time < start_time+5000){
                sum.n++
                sum.x += data_row.x
                sum.y += data_row.y
                sum.z += data_row.z
            } else {
                // we are more than 5 sec, return the means
                // and reset...
                if (sum.n != 0) {
                    return_value.push({
                        mid_time: start_time + 2500,
                        x_bar: sum.x / sum.n,
                        y_bar: sum.y / sum.n,
                        z_bar: sum.z / sum.n,
                        n: sum.n
                    })
                }
                sum.x=0
                sum.y=0
                sum.z=0
                sum.n=0
                start_time = data_row.time
            } 
        }

        // often the return value is empty....
        return return_value;
    }
}