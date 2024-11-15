const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const app = express();
const PORT = 5003;
app.use(cors());

async function getDataFromPage(url, limit, res) {

    console.log('url',url);
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,720'
        ]
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    await page.goto('https://authentication.demandbase.com/signin');

    const usernameSelector = '#okta-signin-username';
    const passwordSelector = '#okta-signin-password';
    const submitSelector = '#okta-signin-submit';

    await page.waitForSelector(usernameSelector);
    await page.fill(usernameSelector, 'bgreer@shepherdsgm.com');

    await page.waitForSelector(passwordSelector);
    await page.fill(passwordSelector, 'Comfirm@2234');

    // Click submit
    await page.waitForSelector(submitSelector);
    await Promise.all([
        page.click(submitSelector),
        page.waitForNavigation({ waitUntil: 'networkidle' })
    ]);
    let submitDemandbaseOne = 'xpath=//html/body/div[2]/div[1]/div[2]/div[2]/a[1]';
    await page.waitForSelector(submitDemandbaseOne, { timeout: 5000 });
    await page.click(submitDemandbaseOne);
    await page.waitForTimeout(10000);
    await page.goto(url); //1026419,727617

    const tableXPath = '//*[@id="content"]/div[2]/div/div[3]/div/div/div/div[2]/div[2]/div/div[2]/div/div[4]/div[1]/div/div';
    let retries = 100;

    for (let attempt = 0; attempt < retries; attempt++) {
        if (await page.$(tableXPath)) {
            console.log(`Table found on attempt ${attempt + 1}`);
            break;
        } else {
            console.log(`Table not found, retrying...`);
            await page.waitForTimeout(1000);
        }
    }

    const toalElementXpath = 'xpath=//*[@id="content"]/div[2]/div/div[3]/div/div/div/div[2]/div[2]/div/div[2]/div/div[1]/div/div[1]/span';
    page.waitForSelector(toalElementXpath);
    const totalElement = await page.$(toalElementXpath);
    const total = (await totalElement.innerText()).trim();
    const totalText = (await totalElement.innerText()).trim();
    const totalNumber = parseInt(totalText.replace(/[^0-9]/g, ''), 10);
    console.log(`total elements avalible : ${totalNumber}`);

    let rows = await page.$$('.people-lists__list');
    total_rows = rows.length;
    console.log(`Rows found: ${total_rows}`);
    let row = rows[0];
    let maxRetries = 10;
    currentRetries = 0;

    const data = [];
    let total_indexed = 0;
    const uniqueRecords = new Set();
    let continue_search = true;
    let uniq_not_found = 0;
    let iterated_data = 0;
    while (total_indexed < totalNumber&& continue_search) {//&&iterated_data<totalNumber
        iterated_data++;
        rows = await page.$$('.people-lists__list');
        await page.waitForTimeout(3000);
        total_rows = rows.length;
        console.log('part rows : ', total_rows);

        for (let index = 0; index < total_rows; index++) {
            
            try {
                let click_index_need = true;
                for (let click_index = 0; click_index < 3 && click_index_need; click_index++) {
                    try {
                        rows = await page.$$('.people-lists__list');
                        const rowToClick = rows[index];
                        console.log('clicking row index:', index);
                        await rowToClick.click();
                        click_index_need = false;

                    } catch (error) {
                        console.log('cannpot click row index trying again :', index);
                        await page.waitForTimeout(1500);
                    }
                }

                let loaddata = true;
                for (let loaddata__index = 0; loaddata__index < 7 && loaddata; loaddata__index++) {
                    try {
                        const name = (await (await page.$('.exec-firmo-compact__executive-name-text'))?.innerText()) || "";
                        if(name==""){
                            await page.waitForTimeout(300);
                            continue;
                        }
                        loaddata = false;
                        await page.waitForTimeout(500);
                        const title = (await (await page.$('.exec-firmo-compact__summary__executive__title'))?.innerText()) || "";
                        const email = (await (await page.$('.exec-firmo-compact__people-email-value'))?.innerText()) || "";
                        const phone = (await (await page.$('.exec-firmo-compact__people-phone'))?.innerText()) || "";
                        const home = (await (await page.$('.expand.direct'))?.innerText()) || "";
                        console.log(`Information: ${name}, ${title}, ${email}, ${phone}, ${home} Rown Number ${total_indexed}`);
                        console.log('iterated_data :', iterated_data);
        
                        const uniqueKey = `${name}-${title}-${email}-${phone}-${home}`;
                        
                        if (!uniqueRecords.has(uniqueKey)) {
                            uniqueRecords.add(uniqueKey);
                            data.push({
                                name, title, email, phone, home
                            });
                            uniq_not_found = 0;
                            total_indexed++;
                            const rowData = { name, title, email, phone, home };
                            res.write(`data: ${JSON.stringify(rowData)}\n\n`);
                
                        }
                        else{
                            uniq_not_found++;
                            console.log('uniq_not_found try :  ',uniq_not_found);
                            if(uniq_not_found > 500){
                                console.log('uniq_not_found end ',uniq_not_found);
                                continue_search = false;
                                break;
                            }
                        }

                    } catch (error) {
                        console.log('cannpot click row index trying again :', index);
                        await page.waitForTimeout(1500);
                    }
                }
            } catch (error) {
                console.log('error on index ' + index);
                console.log('error details  ' + error.message);
                console.log('total rows : ', total_rows);

                maxRetries--;
                if (maxRetries < 0) {
                    break;
                }
            }
        }
        try {
            
            await page.evaluate(() => {
                const fifthElement = document.querySelector('.gio-entry-list__item-wrapper:last-child'); 
                fifthElement?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            });
           
            if (total_rows <= 0) {
                console.log('exit due to total rows is ' + total_rows);
                break;
            }
        } catch (error) {
            console.error(`Error in row ${total_indexed}: ${error.message}`);
            currentRetries++;
        }

    }
    console.log(total_indexed , totalNumber, continue_search,iterated_data,totalNumber);
    console.log(total_indexed < totalNumber,continue_search,iterated_data<totalNumber);
    console.log(`Total unique indexed rows: ${data.length}`);

    console.log(`Total indexed rows: ${total_indexed}`);

    // await browser.close();
    return data;
}
app.get('/demand_base', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        console.time("Execution Time");

        let limit = parseInt(req.query.limit) || 5;
        let url = req.query.url || '';
        const data = await getDataFromPage(url, limit, res);

        console.log(`Received request with limit: ${limit}`);

        // Signal completion of data stream
        res.write(`data: [DONE]\n\n`);
        console.timeEnd("Execution Time");
        res.end();
    } catch (error) {
        console.error(`Error in /demand_base route: ${error.message}`);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
