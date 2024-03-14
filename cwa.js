const chunkSize = 512; // Set your desired chunk size


/**
 * Headers are 1024 bytes instead of 512 bytes like the
 * rest of the file.  Need to read twice.  The second
 * 512 byte are unused, so we will ignore them.
 * 
 * Because reading detaches the reader from the buffer, for the next read 
 * make sure you use the buffer in the returned object, not
 * the buffer passed in.
 * 
 * @param {ReadableStreamBYOBReader} reader
 * @param {ArrayBuffer} buffer 
 */
async function readHeader(reader,buffer){
    /*
    typedef struct {
    uint16_t packetHeader;                      ///< @ 0  +2   ASCII "MD", little-endian (0x444D)
    uint16_t packetLength;                      ///< @ 2  +2   Packet length (1020 bytes, with header (4) = 1024 bytes total)
    uint8_t  hardwareType;                      ///< @ 4  +1   Hardware type (0x00/0xff/0x17 = AX3, 0x64 = AX6)
    uint16_t deviceId;                          ///< @ 5  +2   Device identifier
    uint32_t sessionId;                         ///< @ 7  +4   Unique session identifier
    uint16_t upperDeviceId;                     ///< @11  +2   Upper word of device id (if 0xffff is read, treat as 0x0000)
    cwa_timestamp_t loggingStartTime;           ///< @13  +4   Start time for delayed logging
    cwa_timestamp_t loggingEndTime;             ///< @17  +4   Stop time for delayed logging
    uint32_t loggingCapacity;                   ///< @21  +4   (Deprecated: preset maximum number of samples to collect, should be 0 = unlimited)
    uint8_t  reserved1[1];                      ///< @25  +1   (1 byte reserved)
    uint8_t  flashLed;                          ///< @26  +1   Flash LED during recording
    uint8_t  reserved2[8];                      ///< @27  +8   (8 bytes reserved)
    uint8_t  sensorConfig;                      ///< @35  +1   Fixed rate sensor configuration (AX6 only), 0x00 or 0xff means accel only, otherwise bottom nibble is gyro range (8000/2^n dps): 2=2000, 3=1000, 4=500, 5=250, 6=125, top nibble non-zero is magnetometer enabled.
    uint8_t  samplingRate;                      ///< @36  +1   Sampling rate code, frequency (3200/(1<<(15-(rate & 0x0f)))) Hz, range (+/-g) (16 >> (rate >> 6)).
    cwa_timestamp_t lastChangeTime;             ///< @37  +4   Last change meta-data time
    uint8_t  firmwareRevision;                  ///< @41  +1   Firmware revision number
    int16_t  timeZone;                          ///< @42  +2   (Unused: originally reserved for a "Time Zone offset from UTC in minutes", 0xffff = -1 = unknown)
    uint8_t  reserved3[20];                     ///< @44  +20  (20 bytes reserved)
    uint8_t  annotation[OM_METADATA_SIZE];      ///< @64  +448 Scratch buffer / meta-data (448 characters, ignore trailing 0x20/0x00/0xff bytes, url-encoded UTF-8 name-value pairs)
    uint8_t  reserved[512];                     ///< @512 +512 (Reserved for device-specific meta-data in the same format as the user meta-data) (512 bytes)
} cwa_header_t;
*/
    let view = new DataView(buffer);
    let result = await reader.read(view);

    // .. this could be passed into a callback function...
    let resultObj = {
        done: result.done,
        value: result.value,
        isHeader: result.value.getInt16(0,true)==0x444D,
        deviceId: result.value.getInt16(5,true),
        timeZone: result.value.getInt16(42,true),
        loggingStartTime: result.value.getInt32(13,true),
        loggingEndTime: result.value.getInt32(17,true),
        stime:unpack_date_time(result.value.getInt32(13,true)),
        etime:unpack_date_time(result.value.getInt32(17,true))
    }
    let sampleRate = result.value.getInt8(36)
    resultObj.freq = (sampleRate<=0)?1:(3200/(1<<(15-(sampleRate & 0x0f))) )

    // read the next 512 byte buffer...
    // return the buffer for re-use.
    buffer = result.value.buffer;view = new DataView(buffer);
    result = await reader.read(view);
    resultObj.buffer = result.value.buffer;

    return resultObj;
}


/**
 * Data buffers are 512 bytes. 
 * 
 * Because reading detaches the reader from the buffer, for the next read 
 * make sure you use the buffer in the returned object, not
 * the buffer passed in.
 * 
 *    typedef struct
 *   {
 *       uint16_t packetHeader;                      ///< @ 0  +2   ASCII "AX", little-endian (0x5841)	
 *       uint16_t packetLength;                      ///< @ 2  +2   Packet length (508 bytes, with header (4) = 512 bytes total)
 *       uint16_t deviceFractional;                  ///< @ 4  +2   Top bit set: 15-bit fraction of a second for the time stamp, the timestampOffset was already adjusted to minimize this assuming ideal sample rate; Top bit clear: 15-bit device identifier, 0 = unknown;
 *       uint32_t sessionId;                         ///< @ 6  +4   Unique session identifier, 0 = unknown
 *       uint32_t sequenceId;                        ///< @10  +4   Sequence counter (0-indexed), each packet has a new number (reset if restarted)
 *       cwa_timestamp_t timestamp;                  ///< @14  +4   Last reported RTC value, 0 = unknown
 *       uint16_t lightScale;                        ///< @18  +2   AAAGGGLLLLLLLLLL Bottom 10 bits is last recorded light sensor value in raw units, 0 = none; top three bits are unpacked accel scale (1/2^(8+n) g); next three bits are gyro scale (8000/2^n dps)
 *       uint16_t temperature;                       ///< @20  +2   Last recorded temperature sensor value in raw units (bottom 10-bits), 0 = none; (top 6-bits reserved)
 *       uint8_t  events;                            ///< @22  +1   Event flags since last packet, b0 = resume logging, b1 = reserved for single-tap event, b2 = reserved for double-tap event, b3 = reserved, b4 = reserved for diagnostic hardware buffer, b5 = reserved for diagnostic software buffer, b6 = reserved for diagnostic internal flag, b7 = reserved)
 *       uint8_t  battery;                           ///< @23  +1   Last recorded battery level in scaled/cropped raw units (double and add 512 for 10-bit ADC value), 0 = unknown
 *       uint8_t  sampleRate;                        ///< @24  +1   Sample rate code, frequency (3200/(1<<(15-(rate & 0x0f)))) Hz, range (+/-g) (16 >> (rate >> 6)).
 *       uint8_t  numAxesBPS;                        ///< @25  +1   0x32 (top nibble: number of axes, 3=Axyz, 6=Gxyz/Axyz, 9=Gxyz/Axyz/Mxyz; bottom nibble: packing format - 2 = 3x 16-bit signed, 0 = 3x 10-bit signed + 2-bit exponent)
 *       int16_t  timestampOffset;                   ///< @26  +2   Relative sample index from the start of the buffer where the whole-second timestamp is valid
 *       uint16_t sampleCount;                       ///< @28  +2   Number of sensor samples (if this sector is full -- Axyz: 80 or 120 samples, Gxyz/Axyz: 40 samples)
 *       uint8_t  rawSampleData[480];                ///< @30  +480 Raw sample data.  Each sample is either 3x/6x/9x 16-bit signed values (x, y, z) or one 32-bit packed value (The bits in bytes [3][2][1][0]: eezzzzzz zzzzyyyy yyyyyyxx xxxxxxxx, e = binary exponent, lsb on right)
 *       uint16_t checksum;                          ///< @510 +2   Checksum of packet (16-bit word-wise sum of the whole packet should be zero)
 *   } OM_READER_DATA_PACKET;
 * 
 * @param {ReadableStreamBYOBReader} reader
 * @param {ArrayBuffer} buffer 
 */
async function readBuffer(reader, buffer) {
    let view = new DataView(buffer);
    let result = await reader.read(view);
    if (window.verbose){
        console.log(result.value.buffer)
        //console.log(view.byteLength)
        //console.log(result.value.buffer.byteLength)
    }

    let resultObj = {
        done: result.done,
        value: result.value,
        buffer: result.value.buffer
    }
    if (result.done) return resultObj;


    // decode the buffer..
    if (result.value.getInt16(0, true) != 0x5841) {
        throw new Error("Expected a data buffer ....")
    }

    resultObj.deviceFractional = (result.value.getInt16(4,true) & 0x7FFF)
    resultObj.lastRTC = unpack_date_time(result.value.getInt32(14,true)).toDate()
    resultObj.scale = unpack_scale(result.value.getInt16(18,true))
    resultObj.timestampOffset = result.value.getInt16(26,true)
    resultObj.numAxes = (result.value.getInt8(25) >>> 4) // (first Nibble)  3=Axyz;6=Gxyz,Axyz;9=Gxyz,Axyz,Mxyz
    resultObj.packing = (result.value.getInt8(25) & 0xF) // (second Nibble) 2 (3x 16-bints) or 0 (3x 10-bits+2exp bits)
    resultObj.sampleCount = result.value.getInt16(28,true)

    let sampleRate = 1<<(15-(result.value.getInt8(24) & 0x0f))
    resultObj.sampleRate = sampleRate;
    resultObj.freq = (sampleRate<=0)?1:(3200/sampleRate)

    // resultObj.timestampOffset is the sample corresponding to
    // the sample measure with the late timing...  need to 
    // back it up to the start....
    // offset start is in sec convert to ms...
    let time_step = 1000/resultObj.freq
    let timeN = (n) => new Date(resultObj.lastRTC.getTime() + time_step*(n-resultObj.timestampOffset))

    let t0 = timeN(0)
    let t1 = timeN(resultObj.sampleCount-1)

    resultObj.data = []
    // read 3x 10bit + 2
    if (resultObj.packing == 0){
        if (resultObj.numAxes == 3){
            for(let offset = 30;offset<510;offset+=4){
                let unpacked = unpack_accel(result.value.getInt32(offset,true))
                unpacked.time = timeN( (offset-30)/4 ).getTime()
                unpacked.x/=resultObj.scale.accel
                unpacked.y/=resultObj.scale.accel
                unpacked.z/=resultObj.scale.accel
                unpacked.light = resultObj.scale.light;
                resultObj.data.push( unpacked )
            }
        }else{
            throw new Error("Can only handle 3 Axes (AX3)...")
        }
    }
    return resultObj;
}






/*
#define DATETIME_FROM_YMDHMS(_year, _month, _day, _hours, _minutes, _seconds) ( (((unsigned int)(_year) & 0x3f) << 26) | (((unsigned int)(_month) & 0x0f) << 22) | (((unsigned int)(_day) & 0x1f) << 17) | (((unsigned int)(_hours) & 0x1f) << 12) | (((unsigned int)(_minutes) & 0x3f) <<  6) | ((unsigned int)(_seconds) & 0x3f) )
#define DATETIME_YEAR(_v)    ((unsigned char)(((_v) >> 26) & 0x3f))
#define DATETIME_MONTH(_v)   ((unsigned char)(((_v) >> 22) & 0x0f))
#define DATETIME_DAY(_v)     ((unsigned char)(((_v) >> 17) & 0x1f))
#define DATETIME_HOURS(_v)   ((unsigned char)(((_v) >> 12) & 0x1f))
#define DATETIME_MINUTES(_v) ((unsigned char)(((_v) >>  6) & 0x3f))
#define DATETIME_SECONDS(_v) ((unsigned char)(((_v)      ) & 0x3f))
*/
function unpack_date_time(dt){
    return {
        year: ((dt >> 26) & 0x3f) + 2000,
        month: (dt >>22) & 0x0f,
        day: (dt >>17) & 0x1f,
        hours: (dt >>12) & 0x1f,
        minutes: (dt >>6) & 0x3f,
        seconds: dt & 0x3f,
        toString: function(){ return `year: ${this.year} month: ${this.month} day: ${this.day} hour: ${this.hours} minutes: ${this.minutes} seconds: ${this.seconds}`},
        toDate: function(){return new Date(this.year,this.month-1,this.day,this.hours,this.minutes,this.seconds)}
    }
}

function packInto32Bit(a, b, c, d) {
    // Ensure the inputs fit into their respective bit sizes
    if (a < -512 || a > 511) throw "a does not fit into 10 bits";
    if (b < -512 || b > 511) throw "b does not fit into 10 bits";
    if (c < -512 || c > 511) throw "c does not fit into 10 bits";
    if (d < 0 || d > 3) throw "d does not fit into 2 bits";

    // Convert signed 10-bit numbers to unsigned 10-bit numbers
    a = a & 0x3FF;
    b = b & 0x3FF;
    c = c & 0x3FF;

    // Pack the numbers into a 32-bit integer
    return (d << 30) | (a << 20) | (b << 10) | c;
}


function unpack_accel(num){
    // https://github.com/digitalinteraction/openmovement/blob/master/Software/AX3/cwa-convert/c/main.c#L663C1-L666C1
    //    x = (signed short)((unsigned short)(value <<  6) & (unsigned short)0xffc0) >> (6 - (unsigned char)(value >> 30));		// Sign-extend 10-bit value, adjust for exponent
    //    y = (signed short)((unsigned short)(value >>  4) & (unsigned short)0xffc0) >> (6 - (unsigned char)(value >> 30));		// Sign-extend 10-bit value, adjust for exponent
    //    z = (signed short)((unsigned short)(value >> 14) & (unsigned short)0xffc0) >> (6 - (unsigned char)(value >> 30));		// Sign-extend 10-bit value, adjust for exponent

    // Extract the numbers from the 32-bit integer
    let e = (num >> 30) & 0x3;
    let z = (num >> 20) & 0x3FF;
    let y = (num >> 10) & 0x3FF;
    let x = num & 0x3FF;
    
    // Convert unsigned 10-bit numbers to signed 10-bit numbers
    if (x > 511) x -= 1024;
    if (y > 511) y -= 1024;
    if (z > 511) z -= 1024;
    return {x: x << e, y: y <<e, z:z << e}
}

function unpack_scale(num){
    // light is least significant 10 bits, accel scale 3-MSB, gyro scale next 3 bits: AAAGGGLLLLLLLLLL
    let accel = 1 << (8 + ((num >>> 13) ));  // 2^(8+AAA) (if AAA==0, scale==256)
    
    let gyro = (num >> 10) & 0x07
    gyro = (gyro==0)?gyro:8000/gyro
    
    let light = num & 0x3FF
    
//    console.log(num,num.toString(2),accel,gyro,light)
    return {
        accel: accel,
        gyro: gyro,
        light: light
    }
}

/**
 * @param {*} url - url of the file
 * @param {*} options - object possibly containing callback and max_buffers
 * @returns 
 */
export async function read_cwa(url,options) {
    let max_buffers = options?.buffers || null
    let callback = options?.callback || null

    let response = await fetch(url)
    if (!response.ok) throw new Error(`Problem reading url ${url}`)

    let body = response.body;
    const reader = body.getReader({ mode: "byob" });
    let buffer = new ArrayBuffer(512); // 512 buffer
    let header = await readHeader(reader, buffer)

    if (!header.isHeader) {
        throw new Error("Did not get a header....")
    }

    if (max_buffers == null){
        const content_length = response.headers.get('Content-Length')
        if (!content_length || content_length == 0) {
            throw new Error('Did not get the length of the CWA file.')
        }
        max_buffers = (content_length-1024)/512
    }

    // read the first data buffer to get info not
    // in the header...
    let results = await readBuffer(reader, header.buffer)
    let buffer_number = 1

    let return_value = null;
    let results_offset = 0
    if (callback){
        return_value = []
        let x=callback(results.data)
        if (x.length > 0) return_value.push(x)
    } else{
        return_value = new Array(max_buffers*results.sampleCount)
        return_value.splice(0,results.sampleCount,...results.data)
        results_offset = results.sampleCount;
    }

    console.time("time to read: ")
    while (!results.done) {
        if (buffer_number >= max_buffers) break;
        results = await readBuffer(reader, results.buffer)
        if (!results.done) {
            buffer_number++
            if (callback) {
                let x=callback(results.data)
                if (x.length > 0) return_value.push(...x)
            } else {
                if (buffer_number %1000 == 0) console.log(`read ${buffer_number} buffers out of ${max_buffers}`)
                return_value.splice(results_offset,results.sampleCount,...results.data)
                results_offset += results.sampleCount
            }
        } else {
            if (callback) {
                return_value.push(...callback(false))
            }
        }
    }
    if (buffer_number != max_buffers){
        console.log("... need to trim the results array ...")
    }

    console.timeEnd("time to read: ")
    console.log(`All done... Read ${buffer_number} buffers`)
    reader.cancel()
    return {
        header: header,
        data: return_value,
        buffer_read: buffer_number
    };
}

