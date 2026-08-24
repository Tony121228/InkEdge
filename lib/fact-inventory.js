const { countCjk, splitSentences } = require('./text-metrics');

const TIME_PATTERN = /(?:今天|昨天|前天|那天|上周|本周|周末|清晨|早上|上午|中午|午后|下午|傍晚|晚上|夜里|深夜|放学时|放学后|课后|睡前|春天|夏天|秋天|冬天|小学|初中|高中|从前|曾经|从小|小时候|后来|从此|如今|未来|往后|每(?:天|周|月|年|次)|日复一日|久而久之|没过多久|[一二三四五六七八九十\d]+(?:年|月|天|小时|分钟|次|周)|好几(?:年|天|次|周))/g;
const PERSON_PATTERN = /(?:我|我们|他|她|它|爸爸|妈妈|父亲|母亲|老师|同学|好友|朋友|学姐|学长|奶奶|爷爷|老奶奶|叔叔|阿姨|邻居|路人|少年|人们|父母|农民伯伯|小伙伴|[^，。！？\s]{1,4}(?:老师|同学|朋友|学姐|学长|奶奶|爷爷|叔叔|阿姨))/g;
const PLACE_PATTERN = /(?:家里|家中|阳台|房间|书桌|窗台|地面|学校|校园|教室|操场|班级|小区|校门口|小区门口|家门口|门口|路上|街道|医院|病床边|公园|田野|村口|小路|小河|河边|树下|角落|窗边|餐桌|赛场|课堂上|课后|生活中|学习中|校园里|在家里)/g;
const OBJECT_PATTERN = /(?:绿萝|叶片|叶子|嫩叶|藤蔓|花盆|花朵|枝叶|枝条|水瓶|白根|书本|书籍|文具|抹布|扫帚|桌面|窗户|窗台|地面|雨伞|伞|菜篮|蔬菜|水果|粮食|米饭|碗|作业|错题|知识点|试卷|成绩单|跳绳|病床|药|书桌|房间|雨点|阳光|树叶|树木|小草|桃花|梨花|迎春花|西瓜|雪糕|晚霞)/g;
const ACTION_PATTERN = /(?:摆放|放着|浇水|擦拭|生长|舒展|垂落|晃动|看着|望着|听着|观察|鼓起|整理|打扫|清扫|分类|归位|拿起|帮助|递给|借出|奔跑|阅读|学习|晨读|听讲|领奖|比赛|完成|坚持|练习|调整|纠正|道歉|赔偿|分担|提醒|珍惜|浪费|取餐|剩饭|剪|插|写完|发呆|陪伴|安慰|分析|梳理|刷题|背书|监督|探讨|打气|背起|赶往|挂号|问诊|取药|照料|复盘|积累|练笔|搀扶|谢绝|洗碗|扫地|清理)/g;
const QUANTITY_PATTERN = /(?:\d+(?:个|只|本|次|年|天|小时|分钟|周|页|分|名)|[一二两三四五六七八九十百千万]+(?:个|只|本|次|年|天|小时|分钟|周|页|分|名|多))/g;
const FEELING_PATTERN = /(?:开心|难过|失落|委屈|愧疚|自豪|安心|温暖|感动|疲惫|舒服|轻松|慌乱|羡慕|自卑|沮丧|欣慰|快乐|勇气|成就感|过意不去|心情舒畅|满心[^，。！？]{0,10})/g;
const SENSORY_PATTERN = /(?:豆大的雨点|噼里啪啦|湿漉漉|灰蒙蒙|翠绿|嫩绿|深绿色|金色|斑驳|清香|蝉鸣|蛙声|滚烫|头晕|腰酸背痛|额头布满汗水|晚风微凉|空气清新|银装素裹)/g;

function unique(items) {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function collectMatches(text, pattern) {
  pattern.lastIndex = 0;
  return unique(String(text || '').match(pattern) || []);
}

function inferTopic(text) {
  const raw = String(text || '');
  const candidates = ['善意', '绿萝', '劳动', '时光', '阅读', '自律', '诚信', '友谊', '家乡', '春天', '夏天', '冬天', '父爱', '挫折', '担当', '粮食', '梦想', '追梦'];
  return candidates.find((item) => raw.includes(item)) || '';
}

function sentenceHasAny(sentence, pattern) {
  pattern.lastIndex = 0;
  return pattern.test(sentence);
}

function extractEvents(text) {
  return splitSentences(text)
    .filter((sentence) => sentenceHasAny(sentence, ACTION_PATTERN))
    .map((sentence) => ({
      subject: (sentence.match(PERSON_PATTERN) || [''])[0],
      action: (sentence.match(ACTION_PATTERN) || [''])[0],
      object: (sentence.match(OBJECT_PATTERN) || [''])[0],
      evidence: sentence
    }))
    .filter((item) => item.action || item.object)
    .slice(0, 20);
}

function extractObservations(text) {
  return splitSentences(text)
    .filter((sentence) => sentenceHasAny(sentence, OBJECT_PATTERN) && countCjk(sentence) >= 8)
    .slice(0, 20);
}

function extractFeelings(text) {
  return splitSentences(text)
    .filter((sentence) => /心情|心里|疲惫|失落|温暖|舒服|感动|开心|难过|勇气|踏实/.test(sentence))
    .slice(0, 12);
}

function extractJudgments(text) {
  return splitSentences(text)
    .filter((sentence) => /让我|明白|懂得|教会|觉得|品质|成长|坚韧|责任|道理|重要|可贵/.test(sentence))
    .slice(0, 12);
}

function buildFactInventory(text, context = {}) {
  const raw = String(text || '');
  const sourceBoundary = String(context.sourceBoundary || '').trim();
  const sourceText = sourceBoundary ? `${raw}\n${sourceBoundary}` : raw;
  const timeExpressions = collectMatches(sourceText, TIME_PATTERN);
  const persons = collectMatches(sourceText, PERSON_PATTERN);
  const places = collectMatches(sourceText, PLACE_PATTERN);
  const objects = collectMatches(sourceText, OBJECT_PATTERN);
  const actions = collectMatches(sourceText, ACTION_PATTERN);
  const quantities = collectMatches(sourceText, QUANTITY_PATTERN);
  const feelings = collectMatches(sourceText, FEELING_PATTERN);
  const sensoryDetails = collectMatches(sourceText, SENSORY_PATTERN);

  return {
    topic: inferTopic(raw),
    entities: unique([...persons, ...places, ...objects]),
    events: extractEvents(sourceText),
    observations: extractObservations(sourceText),
    feelings: extractFeelings(sourceText),
    judgments: extractJudgments(sourceText),
    anchors: {
      timeExpressions,
      persons,
      places,
      objects,
      actions,
      quantities,
      feelings,
      sensoryDetails
    },
    sourceBoundary,
    forbiddenByAbsence: {
      allowNewTimeSpan: timeExpressions.length > 0,
      allowNewPerson: persons.filter((item) => !['我', '我们', '它'].includes(item)).length > 0,
      allowNewPlace: places.length > 0,
      allowNewAction: actions.length > 0,
      allowNewObject: objects.length > 0,
      allowNewQuantity: quantities.length > 0,
      allowNewFeeling: feelings.length > 0,
      allowNewSensoryDetail: sensoryDetails.length > 0
    }
  };
}

module.exports = {
  ACTION_PATTERN,
  OBJECT_PATTERN,
  PERSON_PATTERN,
  PLACE_PATTERN,
  QUANTITY_PATTERN,
  FEELING_PATTERN,
  SENSORY_PATTERN,
  TIME_PATTERN,
  buildFactInventory,
  collectMatches,
  unique
};
