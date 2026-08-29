/**
 * 环境类型补充声明。
 *
 * 为什么放在这里而不是依赖 auto-imports.d.ts：auto-imports.d.ts 是 unplugin 生成物且被
 * gitignore，其中的全局 `const t` 只对 <script> 生效；Vue 模板里的标识符按"组件实例属性"
 * 查找（vue-tsc 错误消息 "on type '{ emit...; $vfm }'" 可佐证），因此必须通过
 * ComponentCustomProperties 增强让模板拿到 t 的类型。生成物随时可能重新生成/变更，
 * 模板类型不应依赖它。
 */
declare module 'vue' {
  interface ComponentCustomProperties {
    /** 酒馆全局翻译函数，签名见 SillyTavern/public/scripts/i18n.js 的 export function t */
    t: (typeof import('@sillytavern/scripts/i18n'))['t'];
  }
}

declare global {
  interface Window {
    /**
     * 酒馆主页面注入的稳定接口。仅声明扩展实际用到的最小面：
     * 完整接口见 SillyTavern/public/scripts/st-context.js（酒馆源码，非 npm 包）。
     * 字段保留可选——扩展代码已在调用点用 ?. 兜底，运行时缺 getContext 不应抛类型错误。
     */
    SillyTavern?: {
      getContext?: () => any;
    };
  }

  /**
   * ST 原生楼层消息（SillyTavern/public/script.js 中 chat[] 的元素）。
   * 注意与 @types/function/chat_message.d.ts 的 ChatMessage（TavernHelper 子集，字段为
   * message/message_id/role）是两个东西：本仓库里从 @sillytavern/script 导入的 chat[]
   * 实际元素是这里的 ST 原生结构，访问 mes/is_user/is_system/swipe_id 等字段时必须
   * 用本类型断言，不要凭 TavernHelper 子集类型猜字段名。
   * 字段清单已核对酒馆 public/global.d.ts 的 interface ChatMessage 与
   * @types/iframe/exported.sillytavern.d.ts 的 SillyTavern.ChatMessage，二者一致。
   */
  type StChatMessage = {
    name?: string;
    /** 楼层正文（注意：TavernHelper 子集类型的同义字段叫 message，不是 mes） */
    mes?: string;
    title?: string;
    gen_started?: string | number | Date;
    gen_finished?: string | number | Date;
    send_date?: string | number | Date;
    is_user?: boolean;
    is_system?: boolean;
    force_avatar?: string;
    original_avatar?: string;
    swipes?: string[];
    swipe_info?: Record<string, any>[];
    swipe_id?: number;
    extra?: Record<string, any>;
  };

  /**
   * ST 原生角色卡对象（SillyTavern/public/script.js 中 characters[] 的元素）。
   * 注意与 @types/function/character.d.ts 的全局 Character（TavernHelper 子集，扁平字段
   * description/first_messages，无 data）不是同一个东西：扩展代码访问 ch.data.description
   * 这类 V2 卡字段时必须用本类型。字段清单已核对酒馆 public/scripts/char-data.js 的
   * v1CharData/v2CharData typedef 与 public/global.d.ts 的 Character 引用。
   */
  type StCharacter = {
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    creatorcomment?: string;
    tags?: string[];
    chat?: string;
    avatar?: string;
    json_data?: string;
    shallow?: boolean;
    /** V2 卡扩展数据；老卡/异常卡可能缺失，访问一律走 ?. */
    data?: {
      name?: string;
      description?: string;
      personality?: string;
      scenario?: string;
      first_mes?: string;
      mes_example?: string;
      creator_notes?: string;
      character_version?: string;
      extensions?: Record<string, any>;
      character_book?: Record<string, any>;
    };
  };
}

export {};
