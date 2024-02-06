const INTERVAL = 900 * 1000

const MINIMUM_SOURCES_PER_PRICE = 2

const PREVIOUS_EPOCH_START_MILLIS = (Math.floor(Date.now() / INTERVAL) - 1) * INTERVAL
const PREVIOUS_EPOCH_END_MILLIS = ((Math.floor(Date.now() / INTERVAL)) * INTERVAL) - 1
const PREVIOUS_EPOCH_START_SECONDS = Math.floor(PREVIOUS_EPOCH_START_MILLIS / 1000)
const PREVIOUS_EPOCH_END_SECONDS = Math.floor(PREVIOUS_EPOCH_END_MILLIS / 1000)

const PREVIOUS_EPOCH_START_ISO = new Date(PREVIOUS_EPOCH_START_MILLIS).toISOString()
const PREVIOUS_EPOCH_END_ISO = new Date(PREVIOUS_EPOCH_END_MILLIS).toISOString()

// for USDT<>USD
const FIAT_RAMP_PAIRS = [['BTC', 'USD'], ['USDT', 'USD']]

const PRICE_PRECISION = 10**6

const BINANCE_US_TEMPLATE = `https://api.binance.us/api/v3/klines?symbol=<<FROM>><<TO>>&interval=15m&startTime=` + PREVIOUS_EPOCH_START_MILLIS + `&endTime=` + PREVIOUS_EPOCH_END_MILLIS
const COINBASE_TEMPLATE = `https://api.pro.coinbase.com/products/<<FROM>>-<<TO>>/candles?granularity=900&start=` + PREVIOUS_EPOCH_START_ISO + `&end=` + PREVIOUS_EPOCH_END_ISO
const BITFINEX_TEMPLATE = `https://api-pub.bitfinex.com/v2/candles/trade:15m:t<<FROM>><<TO>>/hist?start=` + PREVIOUS_EPOCH_START_MILLIS + `&end=` + PREVIOUS_EPOCH_END_MILLIS
const KRAKEN_TEMPLATE = `https://api.kraken.com/0/public/OHLC?pair=<<FROM>><<TO>>&interval=15&since=` + PREVIOUS_EPOCH_START_SECONDS

const BINANCE_US_CONFIG = { 'url': BINANCE_US_TEMPLATE, 'exchange_id': 'BNU', 'timestamp_factor': 1, 'timestamp_index':0, 'close_index': 4, 'certificate': '1dfefb84d8fd578e3715ff3f602c1c4fdad67c80a61ad4a47f800295d5334988' }
const COINBASE_CONFIG = { 'url': COINBASE_TEMPLATE, 'exchange_id': 'CBP', 'timestamp_factor': 1000, 'timestamp_index':0, 'close_index': 4, 'certificate': '4cf4dfa51e4dd8b8006dfa5f013e9d479b6485c000ee1526c8b3187856c74c5d' }
const BITFINEX_CONFIG = { 'url': BITFINEX_TEMPLATE, 'exchange_id': 'BFX', 'timestamp_factor': 1, 'timestamp_index':0, 'close_index': 2, 'certificate': '1c1d5438a493b0619f9bad45ec75e232555a69f201c28e2b74b737b76378365b' }
const KRAKEN_CONFIG = { 'url': KRAKEN_TEMPLATE, 'exchange_id': 'KRK', 'timestamp_factor': 1000, 'timestamp_index': 0, 'close_index': 2, 'certificate': 'af871727cd625f7266f63058c3f395997ec5e6075e7a01a7c33e705a8be3fc38' }

const fetch = (config, pairs) => {
    return pairs.map(pair => {
        return new Promise((resolve, reject) => {
            let url = ""
            if(config.exchange_id == "BFX" && pair[0] == "USDT"){
                url = config.url.replace("<<FROM>>", "UST").replace("<<TO>>", pair[1])
            } else {
                url = config.url.replace("<<FROM>>", pair[0]).replace("<<TO>>", pair[1])
            }

            httpGET(url,
                { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/28.0.1500.52 Safari/537.36" },
                (rawResponse, certificate) => {
                    let response = JSON.parse(rawResponse)

                    if (config.exchange_id == "KRK") {
                        response = Object.values(response['result'])[0]
                    }

                    if(certificate === config.certificate){
                        const payload = {
                            'symbol': pair[0]+pair[1],
                            'exchange_id': config.exchange_id,
                            'timestamp': response[0][config.timestamp_index] * config.timestamp_factor,
                            'close': parseFloat(response[0][config.close_index]),
                            'certificate': certificate
                        }
                        resolve(payload)
                    } else {
                        reject("certificate does not match")
                    }
                },
                (errorMessage) => {
                    reject(errorMessage)
                }
            )
        })
    })
}

const median = (values) => {
    values.sort((a,b) => a-b)

    if (values.length%2 == 0){
        return (values[Math.floor(values.length / 2)]+values[Math.floor(values.length / 2)-1])/2.0
    } else {
        return values[Math.floor(values.length / 2)]
    }
}

const normalize = (value) => {
    return Math.round(median(value)*PRICE_PRECISION)
}

const promises = [
    ...fetch(BINANCE_US_CONFIG, FIAT_RAMP_PAIRS),
    ...fetch(COINBASE_CONFIG, FIAT_RAMP_PAIRS),
    ...fetch(BITFINEX_CONFIG, FIAT_RAMP_PAIRS),
    ...fetch(KRAKEN_CONFIG, FIAT_RAMP_PAIRS)
]

Promise.allSettled(promises).then((results) => {
    const fulfilledPayloads = results.filter((result) => result.status === "fulfilled").map((result) => result.value).filter((item) => item.timestamp >= PREVIOUS_EPOCH_START_MILLIS)

    const prices = fulfilledPayloads.reduce((previousValue, currentValue) => {
        if (currentValue.symbol in previousValue) {
            previousValue[currentValue.symbol].push(currentValue.close)
        } else {
            previousValue[currentValue.symbol] = [currentValue.close]
        }
        return previousValue
    }, {})

    try {
        const payload = Object.entries(prices).filter((entry)=> entry[1].length >= MINIMUM_SOURCES_PER_PRICE).map((entry) => [_STD_.chains.aeternity.data.string(entry[0]), _STD_.chains.aeternity.data.int(normalize(entry[1]).toString())])

        _STD_.chains.aeternity.fulfill(
            "https://testnet.aeternity.io",
            "ct_GL5WwZX9NoBYxKqV8nCawiNFf3npYGgksJCx9hv64rFS9MHwU",
            [_STD_.chains.aeternity.data.map(payload)],
            {
                functionName: "fulfill"
            },
            (opHash) => {
                print("Succeeded: " + opHash)
            },
            (err) => {
                print("Failed: " + err)
            },
        )
    } catch(e) {
        console.log(e)
    }
});
