// 每日一句（總覽頁）：靜態清單，不建資料表、不呼叫外部 API。
//
// 收錄原則（查證日期 2026-11-07）：
// - 只收公有領域作品：原作與所用英譯都在 1929 年以前出版（美國公有領域）；作者多在 1955 年以前過世
//   （例外：Helen Keller 1968 年過世，但《Optimism》1903 年出版，依出版年屬公有領域）。
// - 古典作品用公有領域英譯：Marcus Aurelius 用 George Long 譯本（1862）、Epictetus 用 George Long
//   （Discourses）與 T. W. Higginson（Enchiridion, 1865）、Seneca 用 R. M. Gummere 譯本（Loeb, 1917–1925）、
//   老子與孔子用 James Legge 譯本（1891／1861）。
// - 查證方式：每一句都在 Project Gutenberg 或 Wikisource 的原文全文裡逐字比對找到（下載全文後用程式比對，
//   忽略大小寫與標點），英文照原文不改寫，只有從句中截取時把第一個字母改成大寫；找不到原文的、
//   網路上常見但沒有出處的「名言」一律不收。
//   用到的全文：Gutenberg #15877（Meditations, Long）、#45109（Enchiridion）、#10661（Discourses 選集, Long）、
//   #2944（Emerson Essays I）、#205（Walden）、#31622（Optimism）、#2376（Up from Slavery）、#935（Self-Help）、
//   #4507（As a Man Thinketh）、#148（Franklin 自傳）、#43855（The Way to Wealth）、#3330（Analects, Legge）、
//   #216（Tao Te Ching, Legge）、#16287（Talks to Teachers）；Wikisource〈Moral letters to Lucilius〉（Gummere）、
//   〈Citizenship in a Republic〉。
// - 欄位：text＝英文原文；zh＝自己翻的簡短繁中意譯；author；source＝作品（與章節）；
//   year＝原作年代（可留空）；tr＝所用英譯本與年份（只有譯本才有）。
//
// 選句：quoteOf(day) 依台北日期的日序號，在固定洗牌順序裡取一句；同一天每台裝置都一樣，
// 一輪（句數天）內不重複。

export const QUOTES = [
  // —— Marcus Aurelius《Meditations》，George Long 英譯（1862）——
  { text: 'Do not act as if thou wert going to live ten thousand years.', zh: '別活得像還有一萬年可以揮霍。', author: 'Marcus Aurelius', source: 'Meditations IV.17', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'No longer talk at all about the kind of man that a good man ought to be, but be such.', zh: '別再談好人該是什麼樣子，直接成為那樣的人。', author: 'Marcus Aurelius', source: 'Meditations X.16', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'The universe is transformation: life is opinion.', zh: '萬物都在變化，人生是看法造成的。', author: 'Marcus Aurelius', source: 'Meditations IV.3', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'If it is not right, do not do it: if it is not true, do not say it.', zh: '不對的事別做，不真的話別說。', author: 'Marcus Aurelius', source: 'Meditations XII.17', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Look within. Within is the fountain of good, and it will ever bubble up, if thou wilt ever dig.', zh: '往內看。善的泉源在你心裡，只要肯挖，就會一直湧出來。', author: 'Marcus Aurelius', source: 'Meditations VII.59', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Take away thy opinion, and then there is taken away the complaint, I have been harmed.', zh: '拿掉你的看法，「我受傷了」的抱怨也就跟著消失。', author: 'Marcus Aurelius', source: 'Meditations IV.7', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Be like the promontory against which the waves continually break, but it stands firm and tames the fury of the water around it.', zh: '像海岬一樣：浪不停打來，它站得穩穩的，讓四周的怒濤平靜下來。', author: 'Marcus Aurelius', source: 'Meditations IV.49', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Very little indeed is necessary for living a happy life.', zh: '過幸福的日子，其實需要的很少。', author: 'Marcus Aurelius', source: 'Meditations VII.67', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'The art of life is more like the wrestler\'s art than the dancer\'s.', zh: '生活的本事更像摔角，而不是跳舞：要站穩、接得住突如其來的事。', author: 'Marcus Aurelius', source: 'Meditations VII.61', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'In the morning when thou risest unwillingly, let this thought be present—I am rising to the work of a human being.', zh: '早上不想起床時，想著：我起來，是為了做一個人該做的事。', author: 'Marcus Aurelius', source: 'Meditations V.1', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Men exist for the sake of one another. Teach them then or bear with them.', zh: '人是為彼此而活的。能教就教，教不了就包容。', author: 'Marcus Aurelius', source: 'Meditations VIII.59', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Such as are thy habitual thoughts, such also will be the character of thy mind; for the soul is dyed by the thoughts.', zh: '你習慣想什麼，心就長成什麼樣子；靈魂會被思緒染色。', author: 'Marcus Aurelius', source: 'Meditations V.16', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Remember that to change thy opinion and to follow him who corrects thy error is as consistent with freedom as it is to persist in thy error.', zh: '改變想法、接受別人的指正，和堅持己見一樣是自由的選擇。', author: 'Marcus Aurelius', source: 'Meditations VIII.16', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Confine thyself to the present.', zh: '把自己收回到現在。', author: 'Marcus Aurelius', source: 'Meditations VII.29', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'How much trouble he avoids who does not look to see what his neighbor says or does or thinks, but only to what he does himself.', zh: '不去看別人說什麼、做什麼，只顧好自己在做的事，就省掉好多煩惱。', author: 'Marcus Aurelius', source: 'Meditations IV.18', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Loss is nothing else than change.', zh: '失去，不過是改變。', author: 'Marcus Aurelius', source: 'Meditations IX.35', year: 'c. 170', tr: 'George Long 英譯，1862' },

  // —— Epictetus：Enchiridion（T. W. Higginson 譯，1865）、Discourses（George Long 譯）——
  { text: 'Men are disturbed not by things, but by the views which they take of things.', zh: '讓人不安的不是事情本身，而是我們對事情的看法。', author: 'Epictetus', source: 'Enchiridion 5', year: 'c. 125', tr: 'T. W. Higginson 英譯，1865' },
  { text: 'Demand not that events should happen as you wish; but wish them to happen as they do happen, and you will go on well.', zh: '別要求事情照你的意思發生；接受它們實際發生的樣子，你就會過得順。', author: 'Epictetus', source: 'Enchiridion 8', year: 'c. 125', tr: 'T. W. Higginson 英譯，1865' },
  { text: 'If you would improve, be content to be thought foolish and dull with regard to externals.', zh: '想進步，就別怕在外人眼中顯得笨拙。', author: 'Epictetus', source: 'Enchiridion 13', year: 'c. 125', tr: 'T. W. Higginson 英譯，1865' },
  { text: 'Nothing great, said Epictetus, is produced suddenly, since not even the grape or the fig is.', zh: '偉大的事不會一夕完成，連葡萄和無花果都要時間長成。', author: 'Epictetus', source: 'Discourses I.15', year: 'c. 108', tr: 'George Long 英譯，1877' },
  { text: 'It is circumstances (difficulties) which show what men are.', zh: '困境，才顯出一個人是什麼樣的人。', author: 'Epictetus', source: 'Discourses I.24', year: 'c. 108', tr: 'George Long 英譯，1877' },
  { text: 'If you would be a good reader, read; if a writer, write.', zh: '想成為好讀者，就去讀；想成為作家，就去寫。', author: 'Epictetus', source: 'Discourses II.18', year: 'c. 108', tr: 'George Long 英譯，1877' },
  { text: 'Generally then if you would make anything a habit, do it; if you would not make it a habit, do not do it.', zh: '想養成什麼習慣，就去做；不想讓它成為習慣，就別做。', author: 'Epictetus', source: 'Discourses II.18', year: 'c. 108', tr: 'George Long 英譯，1877' },

  // —— Seneca《Moral Letters to Lucilius》，Richard M. Gummere 譯（Loeb，1917–1925）——
  { text: 'Hold every hour in your grasp. Lay hold of to-day\'s task, and you will not need to depend so much upon to-morrow\'s.', zh: '抓住每一個小時。做好今天的事，就不必那麼依賴明天。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 1', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'While we are postponing, life speeds by.', zh: '我們一拖再拖，人生就這樣飛逝。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 1', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'Nothing, Lucilius, is ours, except time.', zh: '除了時間，沒有什麼真正屬於我們。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 1', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'Everywhere means nowhere.', zh: '什麼都碰一點，等於哪裡都沒到。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 2', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'It is not the man who has too little, but the man who craves more, that is poor.', zh: '貧窮的不是擁有太少的人，而是永遠想要更多的人。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 2', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'I feel, my dear Lucilius, that I am being not only reformed, but transformed.', zh: '我感覺自己不只是在修正，而是在蛻變。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 6', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'The process is mutual; for men learn while they teach.', zh: '教與學是互相的：人在教的時候也在學。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 7', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'There are more things, Lucilius, likely to frighten us than there are to crush us; we suffer more often in imagination than in reality.', zh: '嚇到我們的事遠比真正壓垮我們的多；我們更常在想像裡受苦。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 13', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'You need a change of soul rather than a change of climate.', zh: '你需要的是換一顆心，而不是換個地方。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 28', year: 'c. 65', tr: 'R. M. Gummere 英譯，1917' },
  { text: 'When a man does not know what harbour he is making for, no wind is the right wind.', zh: '不知道要駛向哪個港口，什麼風都不是順風。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 71', year: 'c. 65', tr: 'R. M. Gummere 英譯，1920' },
  { text: 'It is a rough road that leads to the heights of greatness.', zh: '通往高處的，總是一條崎嶇的路。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 84', year: 'c. 65', tr: 'R. M. Gummere 英譯，1920' },
  { text: 'Begin at once to live, and count each separate day as a separate life.', zh: '現在就開始好好活，把每一天都當成完整的一生。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 101', year: 'c. 65', tr: 'R. M. Gummere 英譯，1925' },
  { text: 'No man is good by chance. Virtue is something which must be learned.', zh: '沒有人碰巧就成為好人；品格是要學的。', author: 'Seneca', source: 'Moral Letters to Lucilius, Letter 123', year: 'c. 65', tr: 'R. M. Gummere 英譯，1925' },

  // —— Ralph Waldo Emerson《Essays: First Series》（1841）——
  { text: 'Trust thyself: every heart vibrates to that iron string.', zh: '相信自己：每顆心都會隨那根鋼弦共鳴。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'Insist on yourself; never imitate.', zh: '堅持做你自己，不要模仿別人。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'What I must do is all that concerns me, not what the people think.', zh: '我該在意的是自己必須做的事，不是別人怎麼想。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'Nothing can bring you peace but yourself.', zh: '除了你自己，沒有什麼能帶給你平靜。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'To be great is to be misunderstood.', zh: '偉大，往往意味著被誤解。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'Do that which is assigned you, and you cannot hope too much or dare too much.', zh: '做好交到你手上的事，你再怎麼懷抱希望、再怎麼勇敢都不為過。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'The voyage of the best ship is a zigzag line of a hundred tacks.', zh: '最好的船，航跡也是上百次轉向的之字形。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'Nothing great was ever achieved without enthusiasm.', zh: '沒有熱情，成不了任何偉大的事。', author: 'Ralph Waldo Emerson', source: 'Essays: First Series — Circles', year: '1841' },
  { text: 'Self-trust is the essence of heroism.', zh: '相信自己，是勇氣的核心。', author: 'Ralph Waldo Emerson', source: 'Essays: First Series — Heroism', year: '1841' },
  { text: 'The only reward of virtue is virtue; the only way to have a friend is to be one.', zh: '美德的回報就是美德本身；想要朋友，就先當別人的朋友。', author: 'Ralph Waldo Emerson', source: 'Essays: First Series — Friendship', year: '1841' },

  // —— Henry David Thoreau《Walden》（1854）——
  { text: 'I went to the woods because I wished to live deliberately, to front only the essential facts of life.', zh: '我走進森林，是想有意識地生活，只面對生命中最根本的事。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'Our life is frittered away by detail.', zh: '我們的人生，被瑣碎的細節一點一點耗掉。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'Simplify, simplify.', zh: '簡化，再簡化。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'If one advances confidently in the direction of his dreams, and endeavors to live the life which he has imagined, he will meet with a success unexpected in common hours.', zh: '朝夢想的方向自信前進、努力過想像中的生活，就會遇見平常想不到的成功。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'If you have built castles in the air, your work need not be lost; that is where they should be. Now put the foundations under them.', zh: '空中樓閣不算白蓋，它們本來就該在那裡；現在去幫它們打地基。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'Only that day dawns to which we are awake.', zh: '只有醒著迎接的那一天，才真正破曉。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'However mean your life is, meet it and live it; do not shun it and call it hard names.', zh: '不管日子多平凡，迎上去好好過；別逃避它、也別罵它。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'Things do not change; we change.', zh: '事物沒有改變，是我們改變了。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'I know of no more encouraging fact than the unquestionable ability of man to elevate his life by a conscious endeavor.', zh: '最鼓舞人心的事實是：人確實能靠有意識的努力，讓生命往上提升。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },

  // —— Helen Keller《Optimism: An Essay》（1903）——
  { text: 'Optimism is the faith that leads to achievement; nothing can be done without hope.', zh: '樂觀是通往成就的信念；沒有希望，什麼都做不成。', author: 'Helen Keller', source: 'Optimism', year: '1903' },
  { text: 'Although the world is full of suffering, it is full also of the overcoming of it.', zh: '世界充滿苦難，也充滿了對苦難的克服。', author: 'Helen Keller', source: 'Optimism', year: '1903' },
  { text: 'No pessimist ever discovered the secrets of the stars, or sailed to an uncharted land, or opened a new heaven to the human spirit.', zh: '悲觀的人從沒發現星辰的祕密、航向未知的土地，或為人心打開新的天空。', author: 'Helen Keller', source: 'Optimism', year: '1903' },
  { text: 'Doubt and mistrust are the mere panic of timid imagination, which the steadfast heart will conquer, and the large mind transcend.', zh: '懷疑與不信任只是膽怯想像的慌張；堅定的心能戰勝它，開闊的心能超越它。', author: 'Helen Keller', source: 'Optimism', year: '1903' },

  // —— Booker T. Washington《Up from Slavery》（1901）——
  { text: 'Success is to be measured not so much by the position that one has reached in life as by the obstacles which he has overcome while trying to succeed.', zh: '衡量成功的，與其說是爬到多高，不如說是一路克服了多少阻礙。', author: 'Booker T. Washington', source: 'Up from Slavery', year: '1901' },
  { text: 'Few things help an individual more than to place responsibility upon him, and to let him know that you trust him.', zh: '交給一個人責任、讓他知道你信任他，是對他最大的幫助之一。', author: 'Booker T. Washington', source: 'Up from Slavery', year: '1901' },
  { text: 'It is at the bottom of life we must begin, and not at the top.', zh: '我們必須從底層開始，而不是從頂端。', author: 'Booker T. Washington', source: 'Up from Slavery', year: '1901' },
  { text: 'I have found that the happiest people are those who do the most for others.', zh: '我發現最快樂的人，是為別人做最多的人。', author: 'Booker T. Washington', source: 'Up from Slavery', year: '1901' },

  // —— Samuel Smiles《Self-Help》（1859）——
  { text: 'We often discover what will do, by finding out what will not do; and probably he who never made a mistake never made a discovery.', zh: '常常是試出什麼不行，才找到什麼可行；從不犯錯的人，大概也從沒發現過什麼。', author: 'Samuel Smiles', source: 'Self-Help', year: '1859' },
  { text: 'Energy enables a man to force his way through irksome drudgery and dry details, and carries him onward and upward in every station in life.', zh: '幹勁讓人撐過枯燥的苦差與瑣事，在任何位置上都持續向前、向上。', author: 'Samuel Smiles', source: 'Self-Help', year: '1859' },
  { text: 'It is not eminent talent that is required to ensure success in any pursuit, so much as purpose.', zh: '成功需要的不是過人的天分，而是明確的目標。', author: 'Samuel Smiles', source: 'Self-Help', year: '1859' },

  // —— James Allen《As a Man Thinketh》（1903）——
  { text: 'Circumstance does not make the man; it reveals him to himself.', zh: '環境不會塑造一個人，它只是讓人看清自己。', author: 'James Allen', source: 'As a Man Thinketh', year: '1903' },
  { text: 'Men are anxious to improve their circumstances, but are unwilling to improve themselves; they therefore remain bound.', zh: '人急著改善處境，卻不願改善自己，所以一直被困住。', author: 'James Allen', source: 'As a Man Thinketh', year: '1903' },
  { text: 'Calmness of mind is one of the beautiful jewels of wisdom.', zh: '心的平靜，是智慧最美的寶石之一。', author: 'James Allen', source: 'As a Man Thinketh', year: '1903' },
  { text: 'The dreamers are the saviours of the world.', zh: '做夢的人，是拯救世界的人。', author: 'James Allen', source: 'As a Man Thinketh', year: '1903' },
  { text: 'Self-control is strength; Right Thought is mastery; Calmness is power.', zh: '自制是力量，正確的思考是掌控，平靜是能量。', author: 'James Allen', source: 'As a Man Thinketh', year: '1903' },

  // —— Benjamin Franklin ——
  { text: 'Lose no time; be always employ\'d in something useful; cut off all unnecessary actions.', zh: '別浪費時間；總是做有用的事；砍掉一切不必要的動作。', author: 'Benjamin Franklin', source: 'The Autobiography of Benjamin Franklin（十三項美德：勤勉）', year: '1791' },
  { text: 'Resolve to perform what you ought; perform without fail what you resolve.', zh: '決定去做該做的事；決定了，就一定做到。', author: 'Benjamin Franklin', source: 'The Autobiography of Benjamin Franklin（十三項美德：決心）', year: '1791' },
  { text: 'Lost time is never found again; and what we call time enough, always proves little enough.', zh: '失去的時間找不回來；以為時間很夠，最後總是不夠。', author: 'Benjamin Franklin', source: 'The Way to Wealth（Poor Richard\'s Almanack）', year: '1758' },
  { text: 'Diligence is the mother of good luck.', zh: '勤勉是好運之母。', author: 'Benjamin Franklin', source: 'The Way to Wealth（Poor Richard\'s Almanack）', year: '1758' },

  // —— 孔子《論語》，James Legge 英譯（1861）——
  { text: 'Is it not pleasant to learn with a constant perseverance and application?', zh: '學而時習之，不亦說乎？', author: 'Confucius', source: 'The Analects I.1', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'When you have faults, do not fear to abandon them.', zh: '過則勿憚改。', author: 'Confucius', source: 'The Analects I.8', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'Learning without thought is labour lost; thought without learning is perilous.', zh: '學而不思則罔，思而不學則殆。', author: 'Confucius', source: 'The Analects II.15', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'When you know a thing, to hold that you know it; and when you do not know a thing, to allow that you do not know it;—this is knowledge.', zh: '知之為知之，不知為不知，是知也。', author: 'Confucius', source: 'The Analects II.17', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'I am not concerned that I am not known, I seek to be worthy to be known.', zh: '不患莫己知，求為可知也。', author: 'Confucius', source: 'The Analects IV.14', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'When we see men of worth, we should think of equalling them; when we see men of a contrary character, we should turn inwards and examine ourselves.', zh: '見賢思齊焉，見不賢而內自省也。', author: 'Confucius', source: 'The Analects IV.17', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'When I walk along with two others, they may serve me as my teachers.', zh: '三人行，必有我師焉。', author: 'Confucius', source: 'The Analects VII.21', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'The superior man is modest in his speech, but exceeds in his actions.', zh: '君子恥其言而過其行。', author: 'Confucius', source: 'The Analects XIV.29', year: '', tr: 'James Legge 英譯，1861' },

  // —— 老子《道德經》，James Legge 英譯（1891）——
  { text: 'The journey of a thousand li commenced with a single step.', zh: '千里之行，始於足下。', author: 'Lao Tzu', source: 'Tao Te Ching 64', year: '', tr: 'James Legge 英譯，1891' },
  { text: 'He who knows other men is discerning; he who knows himself is intelligent.', zh: '知人者智，自知者明。', author: 'Lao Tzu', source: 'Tao Te Ching 33', year: '', tr: 'James Legge 英譯，1891' },
  { text: 'He who overcomes others is strong; he who overcomes himself is mighty.', zh: '勝人者有力，自勝者強。', author: 'Lao Tzu', source: 'Tao Te Ching 33', year: '', tr: 'James Legge 英譯，1891' },

  // —— William James《Talks to Teachers on Psychology》（1899）——
  { text: 'Seize the very first possible opportunity to act on every resolution you make.', zh: '下了決心，就抓住第一個機會去實行。', author: 'William James', source: 'Talks to Teachers on Psychology', year: '1899' },
  { text: 'Keep the faculty of effort alive in you by a little gratuitous exercise every day.', zh: '每天做一點不必做的小努力，讓「用力」的能力保持活著。', author: 'William James', source: 'Talks to Teachers on Psychology', year: '1899' },
  { text: 'Never suffer an exception to occur till the new habit is securely rooted in your life.', zh: '新習慣還沒扎根之前，一次例外都別給自己。', author: 'William James', source: 'Talks to Teachers on Psychology', year: '1899' },
  { text: 'We are spinning our own fates, good or evil, and never to be undone.', zh: '我們每天都在紡自己的命運，好壞都無法拆掉重來。', author: 'William James', source: 'Talks to Teachers on Psychology', year: '1899' },

  // —— Theodore Roosevelt〈Citizenship in a Republic〉（巴黎索邦演講，1910）——
  { text: 'The credit belongs to the man who is actually in the arena, whose face is marred by dust and sweat and blood.', zh: '榮耀屬於真正站在場上、臉上沾滿塵土汗水與血的人。', author: 'Theodore Roosevelt', source: 'Citizenship in a Republic', year: '1910' },
  { text: 'There is no effort without error and shortcoming.', zh: '沒有不犯錯、沒有不足的努力。', author: 'Theodore Roosevelt', source: 'Citizenship in a Republic', year: '1910' },

  // —— 補充（同上各譯本）——
  { text: 'Short is the little which remains to thee of life. Live as on a mountain.', zh: '剩下的日子不多了，像住在山上那樣，坦然地活。', author: 'Marcus Aurelius', source: 'Meditations X.15', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'The best way of avenging thyself is not to become like the wrong-doer.', zh: '最好的報復，是不要變成傷害你的那種人。', author: 'Marcus Aurelius', source: 'Meditations VI.6', year: 'c. 170', tr: 'George Long 英譯，1862' },
  { text: 'Every habit and faculty is maintained and increased by the corresponding actions.', zh: '每種習慣與能力，都靠相應的行動來維持和增長。', author: 'Epictetus', source: 'Discourses II.18', year: 'c. 108', tr: 'George Long 英譯，1877' },
  { text: 'A man is literally what he thinks, his character being the complete sum of all his thoughts.', zh: '人就是他所想的；品格是所有念頭的總和。', author: 'James Allen', source: 'As a Man Thinketh', year: '1903' },
  { text: 'The superior man wishes to be slow in his speech and earnest in his conduct.', zh: '君子欲訥於言而敏於行。', author: 'Confucius', source: 'The Analects IV.24', year: '', tr: 'James Legge 英譯，1861' },
  { text: 'He who is satisfied with his lot is rich; he who goes on acting with energy has a (firm) will.', zh: '知足者富，強行者有志。', author: 'Lao Tzu', source: 'Tao Te Ching 33', year: '', tr: 'James Legge 英譯，1891' },
  { text: 'There is a time in every man\'s education when he arrives at the conviction that envy is ignorance; that imitation is suicide.', zh: '每個人的成長裡，總有一刻會明白：嫉妒是無知，模仿是自毀。', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', year: '1841' },
  { text: 'Rather than love, than money, than fame, give me truth.', zh: '比起愛、金錢與名聲，給我真實。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'Every morning was a cheerful invitation to make my life of equal simplicity, and I may say innocence, with Nature herself.', zh: '每個早晨都是愉快的邀請：讓生活像自然一樣簡單、純粹。', author: 'Henry David Thoreau', source: 'Walden', year: '1854' },
  { text: 'No race can prosper till it learns that there is as much dignity in tilling a field as in writing a poem.', zh: '要明白耕田和寫詩一樣有尊嚴，才能真正興盛。', author: 'Booker T. Washington', source: 'Up from Slavery', year: '1901' },
];

/** YYYY-MM-DD → 從 1970-01-01 起算的日序號（純日期運算，不受時區影響） */
function dayNumber(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** 固定種子的洗牌順序（mulberry32＋Fisher–Yates），每台裝置算出來都一樣 */
const ORDER = (() => {
  let s = 20261107;
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const idx = QUOTES.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
})();

/** 這一天（台北日期 YYYY-MM-DD）在 QUOTES 裡的索引 */
export function quoteIndexOf(day) {
  const n = ORDER.length;
  return ORDER[((dayNumber(day) % n) + n) % n];
}

/** 這一天的那一句 */
export function quoteOf(day) {
  return QUOTES[quoteIndexOf(day)];
}

/** 一句的出處字串：Author, Source (year)；譯本另外看 q.tr */
export function quoteCite(q) {
  return `${q.author}, ${q.source}${q.year ? ` (${q.year})` : ''}`;
}

/** 複製用的純文字：原文、出處（含譯本）、意譯 */
export function quoteText(q) {
  return `"${q.text}"\n— ${quoteCite(q)}${q.tr ? `，${q.tr}` : ''}\n${q.zh}`;
}
